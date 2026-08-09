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
  readonly toolId: string;
  readonly callBlockId: string;
  readonly permissions: readonly string[];
}

interface PendingPermissionResolver {
  readonly resolve: (decision: "approved" | "denied") => void;
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
  const [pendingPermission, setPendingPermission] =
    useState<PendingPermissionRequest | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const pendingPermissionRef = useRef<PendingPermissionResolver | null>(null);
  const runSequenceRef = useRef(0);

  const settlePermission = useCallback(
    (decision: "approved" | "denied"): void => {
      const pending = pendingPermissionRef.current;
      if (!pending) return;
      pendingPermissionRef.current = null;
      setPendingPermission(null);
      pending.resolve(decision);
    },
    [],
  );

  const requestApproval = useCallback(
    (request: PendingPermissionRequest): Promise<"approved" | "denied"> =>
      new Promise((resolve) => {
        const previous = pendingPermissionRef.current;
        pendingPermissionRef.current = { resolve };
        setPendingPermission({ ...request, permissions: [...request.permissions] });
        previous?.resolve("denied");
      }),
    [],
  );

  const cancelRun = useCallback((): void => {
    abortControllerRef.current?.abort();
    settlePermission("denied");
  }, [settlePermission]);

  const acceptProjection = useCallback((nextProjection: EditorProjection): void => {
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
      await hostBridge.saveProject({
        project: createSpikeProjectSnapshot({
          projectId,
          workspace: latest.workspace,
          program: latest.program,
          interactionManifest: latest.interactionManifest,
        }),
      });
    } catch {
      setOperationError(SAVE_ERROR);
    }
  }, [acceptProjection, canvasRef, hostBridge, projectId]);

  const loadProject = useCallback(async (): Promise<void> => {
    setOperationError(null);
    try {
      const snapshot = await hostBridge.loadProject(projectId);
      if (snapshot) canvasRef.current?.load(snapshot.workspace);
    } catch {
      setOperationError(LOAD_ERROR);
    }
  }, [canvasRef, hostBridge, projectId]);

  const runInput = useCallback(
    async (input: RuntimeInput): Promise<void> => {
      setOperationError(null);
      let abortController: AbortController | null = null;
      try {
        const workspace = canvasRef.current?.save();
        if (!workspace) throw new Error("RUN_WORKSPACE_UNAVAILABLE");
        const latest = buildEditorProjection(workspace);
        assertRunnableProjection(latest, input.entryId);
        acceptProjection(latest);

        cancelRun();
        abortController = new AbortController();
        abortControllerRef.current = abortController;
        const tools = createRuntimeToolMap(latest);
        const dependencies: RuntimeDependencies = {
          runIdFactory: () => {
            runSequenceRef.current += 1;
            return `desktop-run-${runSequenceRef.current}`;
          },
          model: runtimeModel ?? createDeterministicModel(),
          tools,
          requestApproval,
        };
        const outcome: { terminalType: RunTerminalType | null } = {
          terminalType: null,
        };

        await runProgram({
          program: latest.program,
          sourceMap: { ...latest.sourceMap },
          input: runtimeText(input),
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
      } catch (error) {
        const handledTerminal =
          error instanceof RunNotCompletedError && error.terminalType !== null;
        if (!handledTerminal) setOperationError(RUN_ERROR);
        throw error;
      } finally {
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
    ],
  );

  return {
    projection,
    activeEntryId,
    setActiveEntryId,
    runtime,
    pendingPermission,
    operationError,
    acceptProjection,
    saveProject,
    loadProject,
    runInput,
    cancelRun,
    approvePermission: () => settlePermission("approved"),
    denyPermission: () => settlePermission("denied"),
  };
}
