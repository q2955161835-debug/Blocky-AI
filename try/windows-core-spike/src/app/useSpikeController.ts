import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
  type RefObject,
} from "react";
import {
  buildEditorProjection,
  type BlocklyCanvasHandle,
  type EditorProjection,
} from "../blockly/BlocklyCanvas";
import {
  createDeterministicModel,
  runProgram,
  type RuntimeDependencies,
} from "../core/deterministicRuntime";
import type { InteractionEntry } from "../core/interactionManifest";
import { stableStringify, type JsonValue } from "../core/json";
import type { RuntimeEvent, RuntimeEventType } from "../core/runtimeEvents";
import type { ToolContract } from "../core/toolContract";
import type { HostBridge } from "../host/HostBridge";
import { createSpikeProjectSnapshot } from "../project/SpikeProjectSnapshot";
import type { RuntimeInput } from "../runtime/RuntimeComposer";
import type { SubmittedRuntimeInput } from "../runtime/conversationProjection";

export type RuntimeStatus = "idle" | "running" | RuntimeEventType;

export interface RuntimeViewState {
  readonly events: readonly RuntimeEvent[];
  readonly activeBlockId: string | null;
  readonly status: RuntimeStatus;
}

const TERMINAL_EVENTS = new Set<RuntimeEventType>([
  "run.completed",
  "run.cancelled",
  "run.failed",
]);

const EMPTY_WORKSPACE: JsonValue = {
  blocks: { blocks: [], languageVersion: 0 },
};

const RUN_ERROR = "运行失败，请检查积木后重试";
const SAVE_ERROR = "保存失败，请重试";
const LOAD_ERROR = "载入失败，请重试";

type RunTerminalType = "run.completed" | "run.cancelled" | "run.failed";

class RunNotCompletedError extends Error {
  constructor(readonly terminalType: Exclude<RunTerminalType, "run.completed"> | null) {
    super(terminalType === "run.cancelled" ? "RUN_CANCELLED" : "RUN_FAILED");
    this.name = "RunNotCompletedError";
  }
}

export function reduceRuntimeEvent(
  state: RuntimeViewState,
  event: RuntimeEvent,
): RuntimeViewState {
  const events = [...state.events, event].slice(-200);
  if (event.type === "block.started" && event.blockId) {
    return { ...state, events, activeBlockId: event.blockId, status: "running" };
  }
  if (TERMINAL_EVENTS.has(event.type)) {
    return { ...state, events, activeBlockId: null, status: event.type };
  }
  return { ...state, events };
}

export function assertRunnableProjection(
  projection: EditorProjection,
  entryId: string,
): InteractionEntry {
  if (projection.diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    throw new Error("RUN_BLOCKED_BY_DIAGNOSTICS");
  }
  const entry = projection.interactionManifest.entries.find(
    (candidate) => candidate.id === entryId,
  );
  if (!entry) throw new Error("RUN_ENTRY_NOT_FOUND");
  return entry;
}

export function createRuntimeToolMap(
  projection: EditorProjection,
): Map<string, Readonly<ToolContract>> {
  return new Map(
    projection.toolContracts.map((contract) => [contract.id, contract]),
  );
}

interface UseSpikeControllerOptions {
  canvasRef: RefObject<BlocklyCanvasHandle | null>;
  hostBridge: HostBridge;
  projectId: string;
  runtimeModel?: RuntimeDependencies["model"];
}

export interface PendingPermissionRequest {
  readonly runId: string;
  readonly runToken: number;
  readonly projectionRevision: number;
  readonly projectionDigest: string;
  readonly toolId: string;
  readonly callBlockId: string;
  readonly permissions: readonly string[];
}

interface PendingPermissionResolver {
  readonly runToken: number;
  readonly projectionRevision: number;
  readonly projectionDigest: string;
  readonly resolve: (decision: "approved" | "denied") => void;
}

interface RunBinding {
  readonly runToken: number;
  readonly projectionRevision: number;
  readonly projectionDigest: string;
}

interface ActiveRun extends RunBinding {
  readonly abortController: AbortController;
  readonly settled: Promise<void>;
}

function sameRunBinding(left: RunBinding, right: RunBinding): boolean {
  return left.runToken === right.runToken &&
    left.projectionRevision === right.projectionRevision &&
    left.projectionDigest === right.projectionDigest;
}

function runtimeText(input: RuntimeInput): string {
  if (input.text !== undefined) return input.text;
  return input.attachments.map((attachment) => attachment.name).join(", ");
}

export function useSpikeController({
  canvasRef,
  hostBridge,
  projectId,
  runtimeModel,
}: UseSpikeControllerOptions) {
  const [projection, setProjection] = useState<EditorProjection>(() =>
    buildEditorProjection(EMPTY_WORKSPACE),
  );
  const [activeEntryId, setActiveEntryId] = useState<string | null>(null);
  const [runtime, dispatchRuntimeEvent] = useReducer(reduceRuntimeEvent, {
    events: [],
    activeBlockId: null,
    status: "idle",
  });
  const [operationError, setOperationError] = useState<string | null>(null);
  const [submissions, setSubmissions] = useState<readonly SubmittedRuntimeInput[]>([]);
  const [pendingPermission, setPendingPermission] =
    useState<PendingPermissionRequest | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const pendingPermissionRef = useRef<PendingPermissionResolver | null>(null);
  const runSequenceRef = useRef(0);
  const runTokenRef = useRef(0);
  const activeRunRef = useRef<ActiveRun | null>(null);
  const runTransitionRef = useRef<Promise<void>>(Promise.resolve());
  const projectionIdentityRef = useRef({
    revision: 0,
    digest: stableStringify(EMPTY_WORKSPACE),
  });

  const settlePermission = useCallback(
    (
      decision: "approved" | "denied",
      expected: RunBinding,
    ): void => {
      const pending = pendingPermissionRef.current;
      if (!pending || !sameRunBinding(pending, expected)) return;
      const active = activeRunRef.current;
      const projectionIdentity = projectionIdentityRef.current;
      const isCurrent = active !== null &&
        sameRunBinding(active, pending) &&
        projectionIdentity.revision === pending.projectionRevision &&
        projectionIdentity.digest === pending.projectionDigest;
      pendingPermissionRef.current = null;
      setPendingPermission(null);
      pending.resolve(isCurrent ? decision : "denied");
    },
    [],
  );

  const requestApproval = useCallback(
    (
      binding: RunBinding,
      request: Omit<PendingPermissionRequest, keyof RunBinding>,
    ): Promise<"approved" | "denied"> =>
      new Promise((resolve) => {
        const active = activeRunRef.current;
        const projectionIdentity = projectionIdentityRef.current;
        if (
          !active ||
          !sameRunBinding(active, binding) ||
          projectionIdentity.revision !== binding.projectionRevision ||
          projectionIdentity.digest !== binding.projectionDigest
        ) {
          resolve("denied");
          return;
        }
        const previous = pendingPermissionRef.current;
        pendingPermissionRef.current = { ...binding, resolve };
        setPendingPermission({
          ...request,
          ...binding,
          permissions: [...request.permissions],
        });
        previous?.resolve("denied");
      }),
    [],
  );

  const cancelRun = useCallback(async (): Promise<void> => {
    const active = activeRunRef.current;
    if (!active) return;
    active.abortController.abort();
    settlePermission("denied", active);
    await active.settled;
  }, [settlePermission]);

  const withRunTransition = useCallback(
    async <T,>(operation: () => Promise<T> | T): Promise<T> => {
      const previous = runTransitionRef.current;
      let release = (): void => {};
      runTransitionRef.current = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      try {
        return await operation();
      } finally {
        release();
      }
    },
    [],
  );

  const acceptProjection = useCallback((nextProjection: EditorProjection): void => {
    const digest = stableStringify(nextProjection.workspace);
    if (projectionIdentityRef.current.digest !== digest) {
      projectionIdentityRef.current = {
        revision: projectionIdentityRef.current.revision + 1,
        digest,
      };
    }
    setProjection((current) =>
      stableStringify(current.workspace) === stableStringify(nextProjection.workspace)
        ? current
        : nextProjection,
    );
    setActiveEntryId((current) => {
      if (
        current &&
        nextProjection.interactionManifest.entries.some((entry) => entry.id === current)
      ) {
        return current;
      }
      return nextProjection.interactionManifest.entries[0]?.id ?? null;
    });
  }, []);

  const acceptRuntimeEvent = useCallback(
    (event: RuntimeEvent): void => {
      dispatchRuntimeEvent(event);
      if (event.type === "block.started" && event.blockId) {
        canvasRef.current?.highlight(event.blockId);
      } else if (TERMINAL_EVENTS.has(event.type)) {
        canvasRef.current?.highlight(null);
      }
      if (event.type === "run.failed") setOperationError(RUN_ERROR);
    },
    [canvasRef],
  );

  useEffect(
    () => () => {
      abortControllerRef.current?.abort();
      pendingPermissionRef.current?.resolve("denied");
      pendingPermissionRef.current = null;
    },
    [],
  );

  const saveProject = useCallback(async (): Promise<void> => {
    setOperationError(null);
    try {
      const workspace = canvasRef.current?.save();
      if (!workspace) return;
      const latest = buildEditorProjection(workspace);
      acceptProjection(latest);
      const project = createSpikeProjectSnapshot({
        projectId,
        workspace: latest.workspace,
        program: latest.program,
        interactionManifest: latest.interactionManifest,
      });
      await hostBridge.saveProject({
        projectId,
        json: stableStringify(project),
      });
    } catch {
      setOperationError(SAVE_ERROR);
    }
  }, [acceptProjection, canvasRef, hostBridge, projectId]);

  const loadProject = useCallback(async (): Promise<void> => {
    setOperationError(null);
    try {
      await withRunTransition(async () => {
        await cancelRun();
        const snapshot = await hostBridge.loadProject(projectId);
        if (snapshot) canvasRef.current?.load(snapshot.workspace);
      });
    } catch {
      setOperationError(LOAD_ERROR);
    }
  }, [cancelRun, canvasRef, hostBridge, projectId, withRunTransition]);

  const replaceWorkspace = useCallback(
    async (workspace: JsonValue): Promise<void> => {
      await withRunTransition(async () => {
        await cancelRun();
        canvasRef.current?.load(workspace);
      });
    },
    [cancelRun, canvasRef, withRunTransition],
  );

  const runInput = useCallback(
    async (input: RuntimeInput): Promise<{ readonly runId: string }> => {
      setOperationError(null);
      let abortController: AbortController | null = null;
      let resolveSettled = (): void => {};
      try {
        const workspace = canvasRef.current?.save();
        if (!workspace) throw new Error("RUN_WORKSPACE_UNAVAILABLE");
        const latest = buildEditorProjection(workspace);
        assertRunnableProjection(latest, input.entryId);
        acceptProjection(latest);

        const runContext = await withRunTransition(async () => {
          await cancelRun();
          const nextAbortController = new AbortController();
          abortControllerRef.current = nextAbortController;
          runTokenRef.current += 1;
          const binding: RunBinding = {
            runToken: runTokenRef.current,
            projectionRevision: projectionIdentityRef.current.revision,
            projectionDigest: projectionIdentityRef.current.digest,
          };
          const activeRun: ActiveRun = {
            ...binding,
            abortController: nextAbortController,
            settled: new Promise<void>((resolve) => {
              resolveSettled = resolve;
            }),
          };
          activeRunRef.current = activeRun;
          return { abortController: nextAbortController, binding };
        });
        abortController = runContext.abortController;
        const { binding } = runContext;
        const tools = createRuntimeToolMap(latest);
        runSequenceRef.current += 1;
        const runId = `desktop-run-${runSequenceRef.current}`;
        const inputText = runtimeText(input);
        setSubmissions((current) => [...current, {
          runId,
          entryId: input.entryId,
          userText: inputText,
        }].slice(-100));
        const dependencies: RuntimeDependencies = {
          runIdFactory: () => runId,
          model: runtimeModel ?? createDeterministicModel(),
          tools,
          requestApproval: (request) => requestApproval(binding, request),
        };
        const outcome: { terminalType: RunTerminalType | null } = {
          terminalType: null,
        };

        await runProgram({
          program: latest.program,
          sourceMap: { ...latest.sourceMap },
          input: inputText,
          signal: abortController.signal,
          dependencies,
          onEvent: (event) => {
            acceptRuntimeEvent(event);
            if (TERMINAL_EVENTS.has(event.type)) {
              outcome.terminalType = event.type as RunTerminalType;
            }
          },
        });
        if (outcome.terminalType !== "run.completed") {
          throw new RunNotCompletedError(outcome.terminalType);
        }
        return { runId };
      } catch (error) {
        const handledTerminal =
          error instanceof RunNotCompletedError && error.terminalType !== null;
        if (!handledTerminal) setOperationError(RUN_ERROR);
        throw error;
      } finally {
        const active = activeRunRef.current;
        if (active && active.abortController === abortController) {
          activeRunRef.current = null;
        }
        if (abortController) resolveSettled();
        if (abortController && abortControllerRef.current === abortController) {
          abortControllerRef.current = null;
        }
      }
    },
    [
      acceptProjection,
      acceptRuntimeEvent,
      cancelRun,
      canvasRef,
      requestApproval,
      runtimeModel,
      withRunTransition,
    ],
  );

  return {
    projection,
    submissions,
    activeEntryId,
    setActiveEntryId,
    runtime,
    pendingPermission,
    operationError,
    acceptProjection,
    saveProject,
    loadProject,
    replaceWorkspace,
    runInput,
    cancelRun,
    approvePermission: pendingPermission
      ? () => settlePermission("approved", pendingPermission)
      : () => {},
    denyPermission: pendingPermission
      ? () => settlePermission("denied", pendingPermission)
      : () => {},
  };
}
