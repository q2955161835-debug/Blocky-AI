import { useEffect, useRef, useState } from "react";
import { Channel, invoke } from "@tauri-apps/api/core";
import {
  agentMessageLimits,
  canonicalJson,
  containsCredential,
} from "@blocky/language-schema";
import { parseProject, projectDigest } from "@blocky/project-model";
import { encodeProject } from "@blocky/project-format";
import {
  parseCodingStart,
  codingEventSchema,
  codingResultSchema,
  codingChangeSchema,
  codingChangesSchema,
  codingWorkspaceSchema,
  codingRuntimeContextSchema,
  projectPermissions,
  type CodingEvent,
  type CodingResult,
  type CodingChange,
  type CodingRuntimeContext,
} from "@blocky/builder-protocol";
import type { Studio } from "./useStudio";
import {
  codingContext,
  useCodingChat,
  type CodingMessage,
} from "./useCodingChat";

type Workspace = { workspaceId: string; displayName: string };
export type CodingProjectReview = {
  files: { path: string; before: string | null; after: string | null }[];
  permissions: string[];
  status: "applied" | "conflict" | "failed";
  error?: string;
};
const stableContextId = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length <= 200 &&
  /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(value);
const stableContextCode = (value: unknown): value is string =>
  typeof value === "string" && /^BLK-[A-Z0-9-]{1,124}$/.test(value);
function runtimeContext(studio: Studio): CodingRuntimeContext {
  const diagnostics = studio.diagnostics.flatMap((diagnostic) => {
    if (!stableContextCode(diagnostic.code)) return [];
    const source = diagnostic.source;
    return [
      {
        code: diagnostic.code,
        severity: diagnostic.severity,
        ...(stableContextId(source?.moduleId)
          ? { moduleId: source.moduleId }
          : {}),
        ...(stableContextId(source?.blockId)
          ? { blockId: source.blockId }
          : {}),
      },
    ];
  });
  const recentEvents = studio.events
    .filter(
      (event) =>
        event.projectId === studio.snapshot.project.manifest.projectId,
    )
    .map((event) => ({
      type: event.type,
      ...(stableContextId(event.moduleId) ? { moduleId: event.moduleId } : {}),
      ...(stableContextId(event.blockId) ? { blockId: event.blockId } : {}),
      ...(stableContextCode(event.data.code)
        ? { code: event.data.code }
        : {}),
    }));
  const context = {
    diagnostics: diagnostics.slice(-20),
    recentEvents: recentEvents.slice(-20),
  };
  while (new TextEncoder().encode(JSON.stringify(context)).length > 8192) {
    if (context.recentEvents.length >= context.diagnostics.length) {
      if (context.recentEvents.length) context.recentEvents.shift();
      else context.diagnostics.shift();
    } else if (context.diagnostics.length) context.diagnostics.shift();
    else context.recentEvents.shift();
  }
  return codingRuntimeContextSchema.parse(context);
}
const safeError = (cause: unknown) => {
  const text = cause instanceof Error ? cause.message : String(cause);
  return /^BLK-[A-Z0-9-]+$/.test(text) ? text : "BLK-CODING-ENGINE";
};
export function useCodingAgent(studio: Studio) {
  const current = useRef(studio);
  current.current = studio;
  const projectId = studio.snapshot.project.manifest.projectId;
  const chat = useCodingChat(projectId, studio.setMessage);
  const mounted = useRef(true);
  const active = useRef<
    | {
        id: string;
        projectId: string;
        controller: Studio["controller"];
        cancelled: boolean;
        settled: Promise<void>;
        finish(): void;
      }
    | undefined
  >(undefined);
  const folders = useRef(new Map<string, Workspace>());
  const receipts = useRef(
    new Map<
      string,
      {
        change: CodingChange;
        workspaceId: string;
        projectId: string;
        undone: boolean;
        invalidated: boolean;
        requestId?: string;
      }
    >(),
  );
  const operation = useRef(false);
  const localPending = useRef<Promise<void> | undefined>(undefined);
  const [working, setWorking] = useState(false),
    [busy, setBusy] = useState(false),
    [stopping, setStopping] = useState(false);
  const [result, setResult] = useState<CodingResult>(),
    [projectReview, setProjectReview] = useState<CodingProjectReview>();
  const [error, setError] = useState(""),
    [liveText, setLiveText] = useState(""),
    [events, setEvents] = useState<CodingEvent[]>([]);
  const [, refresh] = useState(0);
  const visible = (owner: {
    projectId: string;
    controller: Studio["controller"];
  }) =>
    mounted.current &&
    current.current.controller === owner.controller &&
    current.current.snapshot.project.manifest.projectId === owner.projectId;
  const stop = () => {
    const owner = active.current;
    if (!owner || owner.cancelled) return;
    owner.cancelled = true;
    if (mounted.current) setStopping(true);
    void invoke("coding_cancel", { requestId: owner.id }).catch(() => {});
  };
  const discardProjectCandidate = () => {
    if (!result || !projectReview || projectReview.status === "applied") return;
    chat.update(result.projectId, (messages) =>
      messages.map((message) =>
        message.id === `${result.requestId}-answer`
          ? { ...message, status: "rejected" as const }
          : message,
      ),
    );
    setResult(undefined);
    setProjectReview(undefined);
  };
  const clear = () => {
    stop();
    if (!active.current) {
      setResult(undefined);
      setProjectReview(undefined);
    }
    setError("");
  };
  const newChat = () => {
    if (active.current || operation.current) return;
    chat.update(projectId, () => []);
    setResult(undefined);
    setProjectReview(undefined);
    setError("");
    setLiveText("");
    setEvents([]);
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
    setProjectReview(undefined);
    setError("");
    setLiveText("");
    setEvents([]);
    return () => {
      if (active.current?.controller === studio.controller) stop();
    };
  }, [projectId, studio.controller]);
  const localOperation = async (work: () => Promise<void>) => {
    if (active.current || operation.current || current.current.exiting) return;
    const owner = {
      projectId: current.current.snapshot.project.manifest.projectId,
      controller: current.current.controller,
    };
    operation.current = true;
    setWorking(true);
    setError("");
    let finish!: () => void;
    localPending.current = new Promise((resolve) => {
      finish = resolve;
    });
    try {
      await work();
    } catch (cause) {
      if (visible(owner)) setError(safeError(cause));
    } finally {
      operation.current = false;
      finish();
      localPending.current = undefined;
      if (mounted.current) setWorking(false);
    }
  };
  const pickWorkspace = () =>
    localOperation(async () => {
      const s = current.current,
        id = s.snapshot.project.manifest.projectId;
      const raw = await invoke<unknown>("coding_workspace_pick", {
        projectId: id,
      });
      if (!raw || !visible({ projectId: id, controller: s.controller })) return;
      folders.current.set(id, codingWorkspaceSchema.parse(raw));
      refresh((n) => n + 1);
    });
  const remember = (
    change: CodingChange,
    workspaceId: string | undefined,
    id: string,
    requestId?: string,
  ) => {
    if (containsCredential(JSON.stringify(change)))
      throw Error("BLK-CODING-CHANGE");
    if (!workspaceId) throw Error("BLK-CODING-WORKSPACE");
    const previous = receipts.current.get(change.changeId);
    if (previous && canonicalJson(previous.change) !== canonicalJson(change))
      throw Error("BLK-CODING-CHANGE");
    if (change.revertsChangeId) {
      const original = receipts.current.get(change.revertsChangeId);
      if (original) {
        if (
          original.workspaceId !== workspaceId ||
          original.projectId !== id ||
          original.change.path !== change.path ||
          original.change.afterDigest !== change.beforeDigest ||
          original.change.beforeDigest !== change.afterDigest ||
          original.change.after !== change.before ||
          original.change.before !== change.after
        )
          throw Error("BLK-CODING-CHANGE");
        original.undone = true;
      }
    }
    if (change.invalidatesChangeId) {
      const original = receipts.current.get(change.invalidatesChangeId);
      if (original) {
        if (
          original.workspaceId !== workspaceId ||
          original.projectId !== id ||
          original.change.path !== change.path ||
          original.change.afterDigest !== change.beforeDigest ||
          original.change.after !== change.before ||
          change.after !== null
        )
          throw Error("BLK-CODING-CHANGE");
        original.invalidated = true;
      }
    }
    receipts.current.set(change.changeId, {
      change,
      workspaceId,
      projectId: id,
      undone: previous?.undone ?? false,
      invalidated: previous?.invalidated ?? false,
      requestId: previous?.requestId ?? requestId,
    });
    if (receipts.current.size > 128)
      receipts.current.delete(receipts.current.keys().next().value!);
    refresh((n) => n + 1);
  };
  const refreshWorkspace = async (id: string) => {
    const raw = await invoke<unknown>("workspace_status", { projectId: id });
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
      throw Error("BLK-CODING-WORKSPACE");
    const value = raw as Record<string, unknown>;
    if (
      Object.keys(value).some(
        (key) =>
          !["available", "workspaceId", "displayName", "changes"].includes(
            key,
          ),
      )
    )
      throw Error("BLK-CODING-WORKSPACE");
    const workspace =
      value.available === true
        ? codingWorkspaceSchema.parse({
            workspaceId: value.workspaceId,
            displayName:
              typeof value.displayName === "string" &&
              value.displayName.length > 0
                ? value.displayName
                : "工作文件夹",
          })
        : value.available === false &&
            value.workspaceId === null &&
            value.displayName === null
          ? undefined
          : (() => {
              throw Error("BLK-CODING-WORKSPACE");
            })();
    const changes = codingChangesSchema.parse(value.changes);
    if (workspace) folders.current.set(id, workspace);
    else folders.current.delete(id);
    for (const change of changes)
      remember(change, workspace?.workspaceId, id);
    refresh((n) => n + 1);
    return workspace;
  };
  const undoChange = (changeId: string) =>
    localOperation(async () => {
      const receipt = receipts.current.get(changeId),
        s = current.current;
      if (
        !receipt ||
        receipt.undone ||
        receipt.invalidated ||
        receipt.projectId !== s.snapshot.project.manifest.projectId
      )
        throw Error("BLK-CODING-CHANGE");
      let reversed: CodingChange;
      try {
        reversed = codingChangeSchema.parse(
          await invoke("coding_undo", {
            workspaceId: receipt.workspaceId,
            changeId,
          }),
        );
      } catch (cause) {
        try {
          if (!receipt.requestId) throw Error("BLK-CODING-STALE");
          const changes = codingChangesSchema.parse(
            await invoke("coding_changes", { requestId: receipt.requestId }),
          );
          for (const change of changes)
            remember(
              change,
              receipt.workspaceId,
              receipt.projectId,
              receipt.requestId,
            );
        } catch {
          if (
            visible({ projectId: receipt.projectId, controller: s.controller })
          )
            s.setMessage("撤回未完成；无法读取变更回执，请检查工作文件夹。");
        }
        throw cause;
      }
      if (
        reversed.path !== receipt.change.path ||
        reversed.beforeDigest !== receipt.change.afterDigest ||
        reversed.afterDigest !== receipt.change.beforeDigest ||
        reversed.before !== receipt.change.after ||
        reversed.after !== receipt.change.before ||
        (reversed.revertsChangeId !== undefined &&
          reversed.revertsChangeId !== changeId)
      )
        throw Error("BLK-CODING-CHANGE");
      remember(
        reversed,
        receipt.workspaceId,
        receipt.projectId,
        receipt.requestId,
      );
      receipt.undone = true;
      if (mounted.current) refresh((n) => n + 1);
    });
  const applyProjectCandidate = async (
    s: Studio,
    candidate: CodingResult,
    review: CodingProjectReview,
  ): Promise<CodingProjectReview> => {
    const owner = { projectId: candidate.projectId, controller: s.controller };
    try {
      if (
        !candidate.project ||
        candidate.projectId !==
          s.controller.getSnapshot().project.manifest.projectId
      )
        throw Error("BLK-CODING-PROJECT");
      const original = s.controller.getSnapshot().project;
      const before = canonicalJson(original);
      if ((await projectDigest(original)) !== candidate.baseDigest)
        throw Error("BLK-PATCH-001");
      await s.resources.flush();
      if (!visible(owner) || current.current.exiting)
        throw Error("BLK-CODING-CANCELLED");
      const checked = parseProject(
        await invoke("coding_validate_project", {
          requestId: candidate.requestId,
          originalJson: before,
          project: candidate.project,
          approved: review.permissions,
        }),
      );
      if (canonicalJson(checked) !== canonicalJson(candidate.project))
        throw Error("BLK-CODING-PROJECT");
      const latest = s.controller.getSnapshot().project;
      if (
        !visible(owner) ||
        current.current.exiting ||
        latest.manifest.projectId !== candidate.projectId ||
        canonicalJson(latest) !== before ||
        (await projectDigest(latest)) !== candidate.baseDigest
      )
        throw Error("BLK-PATCH-001");
      s.controller.edit((project) => {
        if (canonicalJson(project) !== before) throw Error("BLK-PATCH-001");
        for (const key of Object.keys(project))
          delete (project as unknown as Record<string, unknown>)[key];
        Object.assign(project, checked);
      });
      s.setMessage("代码助手的项目修改已应用，可整体撤销。");
      return { ...review, status: "applied" };
    } catch (cause) {
      const code = safeError(cause);
      if (visible(owner)) {
        setError(code);
        s.setMessage(
          code === "BLK-PATCH-001"
            ? "项目已变化，代码助手保留了候选修改，未覆盖当前内容。"
            : "项目修改未能自动应用，候选内容仍可查看。",
        );
      }
      return {
        ...review,
        status: code === "BLK-PATCH-001" ? "conflict" : "failed",
        error: code,
      };
    }
  };
  const generate = async (input: { prompt: string; resourceId: string }) => {
    if (
      active.current ||
      operation.current ||
      !chat.ready ||
      current.current.busy ||
      current.current.running ||
      current.current.exiting
    )
      return;
    const s = current.current,
      id = `coding-${crypto.randomUUID()}`;
    let finish!: () => void;
    const settled = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const owner = {
      id,
      projectId,
      controller: s.controller,
      cancelled: false,
      settled,
      finish,
    };
    active.current = owner;
    setBusy(true);
    setStopping(false);
    setResult(undefined);
    setProjectReview(undefined);
    setError("");
    setLiveText("");
    setEvents([]);
    let workspace = folders.current.get(projectId);
    let appended = false,
      sequence = 0,
      streamed = "",
      streamedBytes = 0,
      fault = "";
    const received = new Map<number, CodingEvent>();
    const answer = (text: string, status: CodingMessage["status"]) =>
      chat.update(owner.projectId, (messages) => [
        ...messages,
        {
          id: `${id}-answer`,
          role: "assistant",
          text,
          status,
        },
      ]);
    const receive = (raw: unknown) => {
      if (!visible(owner)) return;
      const event = codingEventSchema.parse(raw);
      if (
        event.requestId !== id ||
        event.projectId !== owner.projectId ||
        containsCredential(event.text ?? "") ||
        containsCredential(JSON.stringify(event.change ?? {}))
      )
        throw Error("BLK-CODING-EVENT");
      if (received.has(event.sequence)) {
        if (
          canonicalJson(received.get(event.sequence)) !== canonicalJson(event)
        )
          throw Error("BLK-CODING-EVENT");
        return;
      }
      if (event.sequence !== sequence + 1) throw Error("BLK-CODING-EVENT");
      received.set(event.sequence, event);
      sequence = event.sequence;
      if (event.kind === "file.changed" && event.change)
        remember(
          event.change,
          workspace?.workspaceId,
          owner.projectId,
          owner.id,
        );
      if (owner.cancelled) return;
      if (event.kind === "text.delta") {
        const delta = event.text ?? "";
        streamedBytes += new TextEncoder().encode(delta).length;
        if (streamedBytes > agentMessageLimits.outputBytes)
          throw Error("BLK-CODING-BUDGET");
        streamed += delta;
        setLiveText(streamed);
      }
      setEvents((previous) => [...previous, event].slice(-200));
    };
    try {
      workspace = await refreshWorkspace(owner.projectId);
      if (owner.cancelled || !visible(owner))
        throw Error("BLK-CODING-CANCELLED");
      const project = s.controller.getSnapshot().project;
      const start = parseCodingStart({
        schemaVersion: "blocky.coding-start/v1",
        requestId: id,
        projectId: owner.projectId,
        moduleId: s.session.active,
        prompt: input.prompt,
        originalJson: canonicalJson(project),
        resourceId: input.resourceId,
        selection: s.selectedRoots.length
          ? s.selectedRoots
          : s.selected
            ? [s.selected]
            : [],
        conversation: codingContext(chat.messages),
        runtimeContext: runtimeContext(s),
        ...(workspace ? { workspaceId: workspace.workspaceId } : {}),
      });
      chat.update(owner.projectId, (messages) => [
        ...messages.map((message) =>
          message.status === "proposed"
            ? { ...message, status: "stale" as const }
            : message,
        ),
        { id, role: "user", text: start.prompt },
      ]);
      appended = true;
      await s.resources.flush();
      if (owner.cancelled) throw Error("BLK-CODING-CANCELLED");
      const onEvent = new Channel<unknown>();
      onEvent.onmessage = (raw) => {
        try {
          receive(raw);
        } catch (cause) {
          fault = safeError(cause);
          stop();
        }
      };
      const value = codingResultSchema.parse(
        await invoke("coding_run", { start, onEvent }),
      );
      if (fault) throw Error(fault);
      if (
        value.requestId !== id ||
        value.projectId !== owner.projectId ||
        value.baseDigest !== (await projectDigest(project))
      )
        throw Error("BLK-CODING-RESULT");
      if (!visible(owner)) throw Error("BLK-CODING-CANCELLED");
      for (const event of value.events) receive(event);
      for (const change of value.changes)
        remember(change, workspace?.workspaceId, owner.projectId, owner.id);
      if (owner.cancelled) throw Error("BLK-CODING-CANCELLED");
      if (containsCredential(value.text)) throw Error("BLK-CODING-RESULT");
      let review: CodingProjectReview | undefined;
      if (
        value.project &&
        canonicalJson(project) !== canonicalJson(value.project)
      ) {
        const [before, after] = await Promise.all([
          projectPermissions(project, s.resources.map, true),
          projectPermissions(value.project, s.resources.map),
        ]);
        if (after.compiled.diagnostics.some((d) => d.severity === "error"))
          throw Error("BLK-CODING-PROJECT");
        const a = encodeProject(project),
          b = encodeProject(value.project);
        review = {
          permissions: [...after.values]
            .filter((permission) => !before.values.has(permission))
            .sort(),
          files: [...new Set([...Object.keys(a), ...Object.keys(b)])]
            .sort()
            .filter((path) => a[path] !== b[path])
            .map((path) => ({
              path,
              before: a[path] ?? null,
              after: b[path] ?? null,
            })),
          status: "conflict",
        };
        if (
          value.baseDigest ===
          (await projectDigest(s.controller.getSnapshot().project))
        ) {
          review = await applyProjectCandidate(s, value, review);
        } else {
          setError("BLK-PATCH-001");
          s.setMessage(
            "项目已变化，代码助手保留了候选修改，未覆盖当前内容。",
          );
          review = { ...review, status: "conflict", error: "BLK-PATCH-001" };
        }
      } else delete value.project;
      if (owner.cancelled || !visible(owner))
        throw Error("BLK-CODING-CANCELLED");
      answer(
        value.text || "本轮任务已完成。",
        review?.status === "applied"
          ? "accepted"
          : review?.status === "conflict"
            ? "stale"
            : review?.status === "failed"
              ? "failed"
              : "completed",
      );
      setResult(value);
      setProjectReview(review);
    } catch (cause) {
      const code = fault || safeError(cause);
      if (workspace) {
        try {
          const changes = codingChangesSchema.parse(
            await invoke("coding_changes", { requestId: id }),
          );
          for (const change of changes) {
            if (containsCredential(JSON.stringify(change)))
              throw Error("BLK-CODING-CHANGE");
            remember(change, workspace.workspaceId, owner.projectId, owner.id);
          }
        } catch {
          if (visible(owner))
            s.setMessage(
              "任务未完成；如有文件变更回执无法读取，请检查工作文件夹。",
            );
        }
      }
      if (owner.cancelled && !fault) {
        if (appended)
          answer(
            "已停止本轮任务。已完成的文件修改可以在差异中撤回。",
            "cancelled",
          );
      } else if (visible(owner)) {
        setError(code);
        if (appended) answer(`本轮任务未完成（${code}）。`, "failed");
      }
    } finally {
      owner.finish();
      if (active.current === owner) {
        active.current = undefined;
        if (mounted.current) {
          setBusy(false);
          setStopping(false);
          setLiveText("");
        }
      }
    }
  };
  return {
    busy: busy || working,
    stopping,
    ready: chat.ready,
    messages: chat.messages,
    result,
    projectReview,
    error,
    liveText,
    events,
    workspace: folders.current.get(projectId),
    changes: [...receipts.current.values()].filter(
      (receipt) => receipt.projectId === projectId,
    ),
    generate,
    stop,
    clear,
    newChat,
    pickWorkspace,
    undoChange,
    reject: discardProjectCandidate,
    flush: chat.flush,
    settle: async () => {
      const owner = active.current;
      stop();
      await owner?.settled;
      await localPending.current;
      await chat.flush();
    },
  };
}
export type CodingAgent = ReturnType<typeof useCodingAgent>;
