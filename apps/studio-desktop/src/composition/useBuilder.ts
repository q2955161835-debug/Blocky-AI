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
export function useBuilder(studio: Studio) {
  const current = useRef(studio);
  current.current = studio;
  const active = useRef<string | undefined>(undefined);
  const [busy, setBusy] = useState(false),
    [result, setResult] = useState<BuilderProposal>(),
    [error, setError] = useState("");
  const clear = () => {
    const id = active.current;
    active.current = undefined;
    if (id) void invoke("builder_cancel", { requestId: id }).catch(() => {});
    setBusy(false);
    setResult(undefined);
    setError("");
  };
  const scope = `${studio.snapshot.project.manifest.projectId}/${studio.session.active}/${studio.selectedRoots.join(",")}/${studio.selected ?? ""}`;
  useEffect(() => {
    clear();
    return () => {
      const id = active.current;
      active.current = undefined;
      if (id) void invoke("builder_cancel", { requestId: id }).catch(() => {});
    };
  }, [scope]);
  const generate = async (input: BuilderInput) => {
    if (active.current) return;
    const s = current.current,
      id = `builder-${crypto.randomUUID()}`;
    active.current = id;
    setBusy(true);
    setResult(undefined);
    setError("");
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
      });
      await s.resources.flush();
      if (active.current !== id) return;
      const value = await invoke<BuilderProposal>("builder_run", {
        start: {
          request,
          originalJson: canonicalJson(project),
          mode: input.mode,
          resourceId: input.mode === "live" ? input.resourceId : null,
          maxTurns: 4,
        },
      });
      if (active.current !== id) return;
      if (
        value.requestId !== id ||
        value.projectId !== project.manifest.projectId ||
        value.baseDigest !==
          (await projectDigest(
            current.current.controller.getSnapshot().project,
          ))
      )
        throw Error("BLK-PATCH-001");
      if (active.current === id) {
        for (const raw of value.events ?? []) {
          const event = builderEventSchema.parse(raw);
          s.bus.write("builder", "info", event.kind, {
            requestId: id,
            sequence: event.sequence,
            ...(event.tool ? { tool: event.tool } : {}),
          });
        }
        setResult(value);
      }
    } catch (cause) {
      if (active.current === id) {
        const code = cause instanceof Error ? cause.message : String(cause);
        setError(/^BLK-[A-Z0-9-]+$/.test(code) ? code : "BLK-BUILDER-ENGINE");
      }
    } finally {
      if (active.current === id) {
        active.current = undefined;
        setBusy(false);
      }
    }
  };
  return { busy, result, error, generate, clear };
}
export type Builder = ReturnType<typeof useBuilder>;
