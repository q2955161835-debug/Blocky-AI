import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { canonicalJson } from "@blocky/language-schema";
import { projectDigest } from "@blocky/project-model";
import {
  parseBuilderRequest,
  builderEventSchema,
  type BuilderResult,
  type BuilderEvent,
} from "@blocky/builder-protocol";
import type { Studio } from "./useStudio";
import { conversationContext, useBuilderChat } from "./useBuilderChat";
export type { BuilderChatMessage } from "./useBuilderChat";
export type BuilderProposal = BuilderResult & {
  events?: BuilderEvent[];
  engine: string;
  modelApiCalled: boolean;
  generations: {
    provider: string;
    model: string;
    requestId: string;
    transport: string;
    usage: {
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
    } | null;
  }[];
};
export type BuilderInput = {
  intent: "build" | "explain" | "repair";
  prompt: string;
  createSurface: boolean;
  mode: "deterministic" | "live";
  resourceId: string;
};
export type BuilderEvidence = {
  requestId: string;
  outcome: string;
  attempts: {
    turn: number;
    outcome: string;
    response: null | {
      model: string;
      responseId: string;
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
    };
  }[];
};
export function useBuilder(studio: Studio) {
  const current = useRef(studio);
  current.current = studio;
  const projectId = studio.snapshot.project.manifest.projectId;
  const chat = useBuilderChat(projectId, studio.setMessage);
  const mounted = useRef(true);
  const active = useRef<
    | {
        id: string;
        projectId: string;
        cancelled: boolean;
        settled: Promise<void>;
        finish(): void;
      }
    | undefined
  >(undefined);
  const [busy, setBusy] = useState(false),
    [stopping, setStopping] = useState(false),
    [result, setResult] = useState<BuilderProposal>(),
    [error, setError] = useState(""),
    [evidence, setEvidence] = useState<BuilderEvidence>();
  const stop = () => {
    const owner = active.current;
    if (!owner || owner.cancelled) return;
    owner.cancelled = true;
    if (mounted.current) setStopping(true);
    void invoke("builder_cancel", { requestId: owner.id }).catch(() => {});
  };
  const decision = (status: "accepted" | "rejected", patchId?: string) => {
    if (!result || (patchId && result.patch?.patchId !== patchId)) return;
    chat.update(result.projectId, (messages) =>
      messages.map((message) =>
        message.id === `${result.requestId}-answer`
          ? { ...message, status }
          : message,
      ),
    );
    setResult(undefined);
  };
  const reject = () => decision("rejected");
  const clear = () => {
    if (active.current) stop();
    else reject();
    setError("");
    setEvidence(undefined);
  };
  const newChat = () => {
    if (active.current) return;
    chat.update(projectId, () => []);
    setResult(undefined);
    setError("");
    setEvidence(undefined);
  };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      stop();
    };
  }, []);
  useEffect(() => {
    setResult(undefined);
    setError("");
    setEvidence(undefined);
    return () => {
      if (active.current?.projectId === projectId) stop();
    };
  }, [projectId]);
  const generate = async (input: BuilderInput) => {
    if (active.current || !chat.ready) return;
    const s = current.current,
      id = `builder-${crypto.randomUUID()}`;
    let finish!: () => void;
    const settled = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const owner = { id, projectId, cancelled: false, settled, finish };
    active.current = owner;
    setBusy(true);
    setStopping(false);
    setResult(undefined);
    setError("");
    setEvidence(undefined);
    const visible = () =>
      mounted.current &&
      current.current.snapshot.project.manifest.projectId === owner.projectId;
    const answer = (
      text: string,
      status: "proposed" | "explained" | "failed" | "cancelled",
    ) => {
      chat.update(owner.projectId, (messages) => [
        ...messages,
        {
          id: `${id}-answer`,
          role: "assistant",
          text: text.slice(0, 4000),
          status,
        },
      ]);
    };
    let appended = false;
    try {
      const project = s.controller.getSnapshot().project;
      const request = parseBuilderRequest({
        schemaVersion: "blocky.builder-request/v1",
        requestId: id,
        projectId: project.manifest.projectId,
        moduleId: s.session.active,
        intent: input.intent,
        prompt: input.prompt,
        selection: s.selectedRoots.length
          ? s.selectedRoots
          : s.selected
            ? [s.selected]
            : [],
        createSurface: input.createSurface && input.intent === "build",
        conversation: conversationContext(
          chat.messages.map((message) =>
            message.status === "proposed"
              ? { ...message, status: "stale" }
              : message,
          ),
        ),
      });
      chat.update(owner.projectId, (messages) => [
        ...messages.map((message) =>
          message.status === "proposed"
            ? { ...message, status: "stale" as const }
            : message,
        ),
        { id, role: "user", text: input.prompt.trim().slice(0, 4000) },
      ]);
      appended = true;
      await s.resources.flush();
      if (owner.cancelled) throw Error("BLK-BUILDER-CANCELLED");
      const value = await invoke<BuilderProposal>("builder_run", {
        start: {
          request,
          originalJson: canonicalJson(project),
          mode: input.mode,
          resourceId: input.mode === "live" ? input.resourceId : null,
          maxTurns: 4,
        },
      });
      if (owner.cancelled || !visible()) throw Error("BLK-BUILDER-CANCELLED");
      if (
        value.requestId !== id ||
        value.projectId !== project.manifest.projectId ||
        value.baseDigest !==
          (await projectDigest(
            current.current.controller.getSnapshot().project,
          ))
      )
        throw Error("BLK-PATCH-001");
      if (owner.cancelled) throw Error("BLK-BUILDER-CANCELLED");
      if (visible()) {
        for (const raw of value.events ?? []) {
          const event = builderEventSchema.parse(raw);
          s.bus?.write("builder", "info", event.kind, {
            requestId: id,
            sequence: event.sequence,
            ...(event.tool ? { tool: event.tool } : {}),
          });
        }
        answer(
          value.explanation || value.spec.plan.join("\n"),
          value.patch ? "proposed" : "explained",
        );
        setResult(value);
      }
    } catch (cause) {
      if (owner.cancelled) {
        if (appended) answer("已停止本轮构建。", "cancelled");
      } else if (visible()) {
        const code = cause instanceof Error ? cause.message : String(cause);
        const safe = /^BLK-[A-Z0-9-]+$/.test(code)
          ? code
          : "BLK-BUILDER-ENGINE";
        setError(safe);
        if (appended) answer(`本轮构建未完成（${safe}）。`, "failed");
        const recorded = await invoke<BuilderEvidence>("builder_evidence", {
          requestId: id,
        }).catch(() => undefined);
        if (visible() && !owner.cancelled && recorded?.requestId === id)
          setEvidence(recorded);
      }
    } finally {
      owner.finish();
      if (active.current === owner) {
        active.current = undefined;
        if (mounted.current) {
          setBusy(false);
          setStopping(false);
        }
      }
    }
  };
  return {
    busy,
    stopping,
    ready: chat.ready,
    messages: chat.messages,
    result,
    error,
    evidence,
    generate,
    clear,
    stop,
    reject,
    newChat,
    markApplied: (patchId: string) => decision("accepted", patchId),
    markRejected: (patchId: string) => decision("rejected", patchId),
    flush: chat.flush,
    settle: async () => {
      const owner = active.current;
      stop();
      await owner?.settled;
      await chat.flush();
    },
  };
}
export type Builder = ReturnType<typeof useBuilder>;
