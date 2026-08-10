import type { BlockyProgram, IrNode } from "./ir";
import { createRuntimeEvent, type RuntimeEvent, type RuntimeEventType } from "./runtimeEvents";
import { resolveToolUsages, type ToolContract } from "./toolContract";

export interface RuntimeDependencies {
  runIdFactory(): string;
  model: {
    stream(input: string, signal: AbortSignal): AsyncIterable<string>;
  };
  tools: Map<string, Readonly<ToolContract>>;
  requestApproval(request: {
    runId: string;
    toolId: string;
    callBlockId: string;
    permissions: string[];
  }): Promise<"approved" | "denied">;
}

export interface RunProgramOptions {
  program: BlockyProgram;
  sourceMap: Record<string, { nodeId: string }>;
  input: string;
  signal: AbortSignal;
  dependencies: RuntimeDependencies;
  onEvent(event: RuntimeEvent): void;
}

class RuntimeFailure extends Error {
  constructor(readonly code: string, readonly blockId?: string) {
    super(code);
  }
}

class RuntimeCancelled extends Error {}

function ensureActive(signal: AbortSignal): void {
  if (signal.aborted) throw new RuntimeCancelled();
}

function firstMappedBlock(program: BlockyProgram, sourceMap: Record<string, { nodeId: string }>): string | undefined {
  const blockId = program.roots[0]?.id;
  if (!blockId) return undefined;
  if (!sourceMap[blockId]) throw new RuntimeFailure("RUNTIME_SOURCE_MAP_MISSING");
  return blockId;
}

function explicitToolCallsInOrder(program: BlockyProgram): IrNode[] {
  const calls: IrNode[] = [];
  const visit = (node: IrNode): void => {
    if (node.type === "core.tool.call") calls.push(node);
    for (const child of Object.values(node.inputs)) {
      if (child) visit(child);
    }
    if (node.next) visit(node.next);
  };
  program.roots.forEach(visit);
  return calls;
}

function toolIdForCall(call: IrNode): string | undefined {
  const reference = call.inputs.TOOL;
  const toolId = reference?.type === "core.tool.reference" ? reference.fields.TOOL_ID : undefined;
  return typeof toolId === "string" && toolId.trim() !== "" ? toolId : undefined;
}

function emitFactory(options: RunProgramOptions, runId: string) {
  let sequence = 0;
  let terminal = false;
  return {
    emit(type: RuntimeEventType, data: unknown = {}, blockId?: string): void {
      if (terminal) throw new RuntimeFailure("RUNTIME_EVENT_AFTER_TERMINAL");
      if (blockId !== undefined && !options.sourceMap[blockId]) {
        throw new RuntimeFailure("RUNTIME_SOURCE_MAP_MISSING");
      }
      options.onEvent(createRuntimeEvent({ runId, sequence: ++sequence, type, data, blockId }));
      if (type === "run.completed" || type === "run.failed" || type === "run.cancelled") terminal = true;
    },
    isTerminal: () => terminal,
  };
}

export function createDeterministicModel(): RuntimeDependencies["model"] {
  return {
    async *stream(input: string): AsyncIterable<string> {
      if (input === "/error") throw new RuntimeFailure("MODEL_SIMULATED_FAILURE");
      yield "已收到：";
      yield input;
    },
  };
}

function failureCode(error: unknown): string {
  return error instanceof RuntimeFailure ? error.code : "RUNTIME_SIMULATED_FAILURE";
}

/** Runs only injected model/tool implementations and publishes frozen events through one outlet. */
export async function runProgram(options: RunProgramOptions): Promise<void> {
  const runId = options.dependencies.runIdFactory();
  const events = emitFactory(options, runId);
  let activeBlockId: string | undefined;
  try {
    ensureActive(options.signal);
    events.emit("run.started");

    if (options.input === "/permission") {
      const usages = resolveToolUsages(options.program, options.dependencies.tools);
      const invalidCallIds = new Set(usages.diagnostics
        .filter((diagnostic) => diagnostic.severity === "error" && diagnostic.blockId)
        .map((diagnostic) => diagnostic.blockId as string));
      let requested: (typeof usages.explicitCalls)[number] | undefined;
      for (const callBlock of explicitToolCallsInOrder(options.program)) {
        const toolId = toolIdForCall(callBlock);
        if (!toolId) throw new RuntimeFailure("TOOL_CALL_INVALID", callBlock.id);
        const contract = options.dependencies.tools.get(toolId);
        if (!contract) throw new RuntimeFailure("TOOL_CALL_INVALID", callBlock.id);
        if (!contract.requiresApproval) continue;

        const resolved = usages.explicitCalls.find(({ call }) => call.callBlockId === callBlock.id);
        if (!resolved || invalidCallIds.has(callBlock.id)) {
          throw new RuntimeFailure("TOOL_CALL_INVALID", callBlock.id);
        }
        requested = resolved;
        break;
      }

      if (!requested) throw new RuntimeFailure("TOOL_APPROVAL_CALL_MISSING");
      const { call, contract } = requested;
      if (invalidCallIds.has(call.callBlockId)) throw new RuntimeFailure("TOOL_CALL_INVALID");
      if (!options.sourceMap[call.callBlockId]) throw new RuntimeFailure("RUNTIME_SOURCE_MAP_MISSING");

      ensureActive(options.signal);
      events.emit("block.started", {}, call.callBlockId);
      ensureActive(options.signal);
      events.emit("tool.permission_requested", { permissions: contract.permissions, toolId: contract.id }, call.callBlockId);
      ensureActive(options.signal);
      const decision = await options.dependencies.requestApproval({
        runId,
        toolId: contract.id,
        callBlockId: call.callBlockId,
        permissions: [...contract.permissions],
      });
      ensureActive(options.signal);
      if (decision === "denied") throw new RuntimeFailure("TOOL_PERMISSION_DENIED", call.callBlockId);

      events.emit("tool.started", { toolId: contract.id }, call.callBlockId);
      ensureActive(options.signal);
      events.emit("tool.completed", { result: contract.implementation.result, toolId: contract.id }, call.callBlockId);
      ensureActive(options.signal);
      events.emit("block.completed", {}, call.callBlockId);
      ensureActive(options.signal);
      events.emit("run.completed");
      return;
    }

    const blockId = firstMappedBlock(options.program, options.sourceMap);
    activeBlockId = blockId;
    if (blockId) {
      ensureActive(options.signal);
      events.emit("block.started", {}, blockId);
    }
    for await (const text of options.dependencies.model.stream(options.input, options.signal)) {
      ensureActive(options.signal);
      events.emit("model.chunk", { text }, blockId);
    }
    if (blockId) {
      ensureActive(options.signal);
      events.emit("block.completed", {}, blockId);
    }
    ensureActive(options.signal);
    events.emit("run.completed");
  } catch (error) {
    if (events.isTerminal()) return;
    if (options.signal.aborted || error instanceof RuntimeCancelled) {
      events.emit("run.cancelled");
      return;
    }
    const failureBlockId = error instanceof RuntimeFailure
      ? error.blockId ?? activeBlockId
      : activeBlockId;
    const blockId = failureBlockId && options.sourceMap[failureBlockId]
      ? failureBlockId
      : undefined;
    events.emit("run.failed", { code: failureCode(error) }, blockId);
  }
}
