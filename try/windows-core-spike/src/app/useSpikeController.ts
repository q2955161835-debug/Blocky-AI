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
}

function runtimeText(input: RuntimeInput): string {
  if (input.text !== undefined) return input.text;
  return input.attachments.map((attachment) => attachment.name).join(", ");
}

export function useSpikeController({
  canvasRef,
  hostBridge,
  projectId,
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
  const abortControllerRef = useRef<AbortController | null>(null);
  const runSequenceRef = useRef(0);

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

  useEffect(() => {
    canvasRef.current?.highlight(runtime.activeBlockId);
  }, [canvasRef, runtime.activeBlockId]);

  useEffect(
    () => () => {
      abortControllerRef.current?.abort();
    },
    [],
  );

  const saveProject = useCallback(async (): Promise<void> => {
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
  }, [acceptProjection, canvasRef, hostBridge, projectId]);

  const loadProject = useCallback(async (): Promise<void> => {
    const snapshot = await hostBridge.loadProject(projectId);
    if (snapshot) canvasRef.current?.load(snapshot.workspace);
  }, [canvasRef, hostBridge, projectId]);

  const runInput = useCallback(
    async (input: RuntimeInput): Promise<void> => {
      const workspace = canvasRef.current?.save();
      if (!workspace) throw new Error("RUN_WORKSPACE_UNAVAILABLE");
      const latest = buildEditorProjection(workspace);
      assertRunnableProjection(latest, input.entryId);
      acceptProjection(latest);

      abortControllerRef.current?.abort();
      const abortController = new AbortController();
      abortControllerRef.current = abortController;
      const tools = createRuntimeToolMap(latest);
      const dependencies: RuntimeDependencies = {
        runIdFactory: () => {
          runSequenceRef.current += 1;
          return `desktop-run-${runSequenceRef.current}`;
        },
        model: createDeterministicModel(),
        tools,
        requestApproval: async () => "approved",
      };

      await runProgram({
        program: latest.program,
        sourceMap: { ...latest.sourceMap },
        input: runtimeText(input),
        signal: abortController.signal,
        dependencies,
        onEvent: dispatchRuntimeEvent,
      });
      if (abortControllerRef.current === abortController) {
        abortControllerRef.current = null;
      }
    },
    [acceptProjection, canvasRef],
  );

  return {
    projection,
    activeEntryId,
    setActiveEntryId,
    runtime,
    acceptProjection,
    saveProject,
    loadProject,
    runInput,
  };
}
