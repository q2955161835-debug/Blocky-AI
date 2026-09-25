import { resolveResource, implementationKey } from "@blocky/resource-registry";
import { compileProject } from "@blocky/compiler";
import {
  EventFactory,
  type RuntimeEvent,
  type EventType,
} from "@blocky/observability";
import { parseProject } from "@blocky/project-model";
import {
  evaluateExpression,
  type IrNode,
  type Project,
  type Json,
} from "@blocky/language-schema";
import {
  localAdapters,
  renderAnswer,
  type Adapters,
  type Citation,
} from "./adapters";
import { RunBudget, abortable, utf8 } from "./budget";
import { AgentExecution } from "./agent-execution";
import type { Generation, OutputFile } from "./agent-context";
type Options = {
  sessionId?: string;
  adapters?: Adapters;
  capabilities?: string[];
  now?: () => string;
  monotonicNow?: () => number;
  newId?: () => string;
  delayMs?: number;
  nextSequence?: () => number;
};
export type RunResult = {
  status: "completed" | "failed" | "cancelled";
  answer: string;
  citations: Citation[];
  events: RuntimeEvent[];
  structured?: Json;
  files?: OutputFile[];
  generations?: Generation[];
  modelApiCalled?: boolean;
};
export class Runtime {
  private readonly sessionId: string;
  private readonly sessionMemory = new Map<string, Json>();
  private factory: EventFactory;
  private options: Options;
  private monotonicNow: () => number;
  private running = false;
  private paused = false;
  private stepNext = false;
  private breakpoints = new Set<string>();
  pause() {
    if (this.running) this.paused = true;
  }
  resume() {
    this.paused = false;
    this.stepNext = false;
  }
  step() {
    if (this.running && this.paused) {
      this.stepNext = true;
      this.paused = false;
    }
  }
  constructor(options: Options = {}) {
    this.options = options;
    this.monotonicNow = options.monotonicNow ?? (() => performance.now());
    this.sessionId = options.sessionId ?? `session-${crypto.randomUUID()}`;
    this.factory = new EventFactory(options.now, options.nextSequence);
  }
  async run(
    input: Project,
    interactionId: string,
    question: string,
    options: {
      moduleId?: string;
      signal?: AbortSignal;
      onEvent?: (event: RuntimeEvent) => void;
      debug?: {
        breakpoints?: { moduleId: string; blockId: string }[];
        startBlockId?: string;
      };
      userRegistry?: Map<string, import("@blocky/language-schema").Resource>;
    } = {},
  ): Promise<RunResult> {
    if (this.running) throw Error("BLK-RUN-003: 已有运行");
    const project = parseProject(input),
      runId = this.options.newId?.() ?? `run-${crypto.randomUUID()}`;
    this.running = true;
    const breakpoints = options.debug?.breakpoints ?? [];
    if (breakpoints.some(({ moduleId, blockId }) =>
      !/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(moduleId) ||
      !/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(blockId))) {
      this.running = false;
      throw Error("BLK-RUN-008");
    }
    this.breakpoints = new Set(breakpoints.map(({ moduleId, blockId }) => JSON.stringify([moduleId, blockId])));
    this.stepNext = false;
    const events: RuntimeEvent[] = [];
    const runBudget = new RunBudget(options.signal);
    const signal = runBudget.signal;
    const adapters = this.options.adapters ?? localAdapters();
    const agent = new AgentExecution(
      project,
      question,
      runId,
      this.sessionId,
      runBudget,
      adapters.agent,
      options.userRegistry,
      this.sessionMemory,
    );
    let answer = "",
      citations: Citation[] = [],
      role = "",
      style = "条目",
      status: RunResult["status"] = "completed";
    const emit = (
      type: EventType,
      moduleId?: string,
      blockId?: string,
      data: Record<string, Json> = {},
      correlationId?: string,
    ) => {
      const e = this.factory.create({
        projectId: project.manifest.projectId,
        runId,
        type,
        ...(moduleId ? { moduleId } : {}),
        ...(blockId ? { blockId } : {}),
        ...(correlationId ? { correlationId } : {}),
        data,
      });
      events.push(e);
      options.onEvent?.(e);
    };
    try {
      emit("run.started", undefined, undefined, { summary: "开始运行" });
      if (utf8(question) > 16000) throw Error("BLK-CONTEXT-001");
      const compiled = await compileProject(project, options.userRegistry);
      signal.throwIfAborted();
      if (compiled.diagnostics.some((d) => d.severity === "error"))
        throw Error(compiled.diagnostics[0].code);
      const entries = compiled.interaction.entries.filter(
        (e) =>
          e.interactionId === interactionId &&
          (options.moduleId === undefined || e.moduleId === options.moduleId),
      );
      if (entries.length !== 1) throw Error("BLK-RUN-001");
      const entry = entries[0];
      if (!entry) throw Error("BLK-RUN-001");
      const capabilities = this.options.capabilities ?? ["knowledge.read"];
      const module = compiled.modules.find(
        (m) => m.moduleId === entry.moduleId,
      )!;
      const root = module.roots.find((n) => n.nodeId === entry.ownerAgentId);
      const selectedEntry = root && findEntry(root, entry.interactionId);
      if (!root || !selectedEntry) throw Error("BLK-RUN-001");
      const handler = selectedEntry === root && selectedEntry.blockType === "core.interaction.chat_entry"
        ? selectedEntry.inputs.HANDLER
        : undefined;
      const handlerHead = handler && !Array.isArray(handler) ? handler : undefined;
      const startNode = options.debug?.startBlockId
        ? options.debug.startBlockId === handlerHead?.nodeId
          ? handlerHead
          : findInNextChain(selectedEntry, options.debug.startBlockId)
        : selectedEntry;
      if (!startNode) throw Error("BLK-RUN-009");
      if (startNode !== selectedEntry &&
          (selectedEntry === root ? startNode !== handlerHead : selectedEntry.next !== startNode))
        throw Error("BLK-RUN-010");
      const pauseBoundary = async (moduleId?: string, blockId?: string) => {
        if (blockId && (this.stepNext || this.breakpoints.has(JSON.stringify([moduleId, blockId])))) {
          this.paused = true;
          this.stepNext = false;
        }
        if (!this.paused) return;
        emit("run.paused", moduleId, blockId, {
          summary: "运行已暂停",
          ...(blockId ? { blockId } : {}),
        });
        while (this.paused) {
          await wait(20, signal);
        }
        signal.throwIfAborted();
        emit("run.resumed", moduleId, blockId, { summary: "运行已继续" });
      };
      const execute = async (node: IrNode, moduleId: string): Promise<void> => {
        signal.throwIfAborted();
        const startedAt = this.monotonicNow();
        // Each chat block starts its own stack. A different entry is a boundary.
        if (
          ["core.interaction.chat", "core.interaction.chat_entry"].includes(
            node.blockType,
          ) &&
          node.nodeId !== entry.interactionId
        )
          return;
        await pauseBoundary(moduleId, node.nodeId);
        runBudget.step();
        emit("block.started", moduleId, node.nodeId, {
          summary: "正在运行",
          blockType: node.blockType,
          inputPorts: Object.keys(node.inputs).sort(),
        });
        try {
          await wait(this.options.delayMs ?? 0, signal);
          signal.throwIfAborted();
          await pauseBoundary();
          let handled: boolean;
          const toolCall = node.blockType === "core.tool.invoke";
          const toolCorrelation = `${runId}-${node.nodeId}-${runBudget.calls + 1}`;
          if (toolCall)
            emit(
              "tool.started",
              moduleId,
              node.nodeId,
              { toolId: `tool-${moduleId}-${node.nodeId}` },
              toolCorrelation,
            );
          try {
            handled = await agent.execute(node, (child) =>
              execute(child, moduleId),
            );
            if (toolCall)
              emit(
                "tool.completed",
                moduleId,
                node.nodeId,
                { summary: "工具运行完成" },
                toolCorrelation,
              );
          } catch (error) {
            if (toolCall)
              emit(
                "tool.failed",
                moduleId,
                node.nodeId,
                {
                  code: signal.aborted ? "BLK-RUN-005" : safeCode(error),
                  summary: "工具调用未完成",
                },
                toolCorrelation,
              );
            throw error;
          }
          if (!handled)
            switch (node.blockType) {
              case "core.message.reply": {
                const evaluate = async (
                  value: IrNode | IrNode[] | null | undefined,
                ): Promise<Json> => {
                  if (!value || Array.isArray(value))
                    throw Error("BLK-TYPE-009");
                  signal.throwIfAborted();
                  await pauseBoundary();
                  runBudget.step();
                  const expressionStartedAt = this.monotonicNow();
                  emit("block.started", moduleId, value.nodeId, {
                    summary: "正在运行",
                    blockType: value.blockType,
                    inputPorts: Object.keys(value.inputs).sort(),
                  });
                  await wait(this.options.delayMs ?? 0, signal);
                  let result: Json;
                  if (value.blockType === "core.data.literal")
                    result = value.fields.VALUE ?? null;
                  else if (value.blockType === "core.data.transform") {
                    const input = value.inputs.ARGUMENTS
                      ? await evaluate(value.inputs.ARGUMENTS)
                      : JSON.parse(question);
                    result = evaluateExpression(value.fields.PROGRAM, input);
                  } else if (value.blockType === "core.message.create") {
                    const content = await evaluate(value.inputs.CONTENT);
                    result =
                      typeof content === "string"
                        ? content
                        : JSON.stringify(content);
                  } else throw Error("BLK-TYPE-009");
                  signal.throwIfAborted();
                  emit("block.completed", moduleId, value.nodeId, {
                    summary: "已完成",
                    elapsedMs: Math.max(0, Math.floor(this.monotonicNow() - expressionStartedAt)),
                    outputType: result === null ? "null" : Array.isArray(result) ? "array" : typeof result,
                  });
                  return result;
                };
                const text = await evaluate(node.inputs.MESSAGE);
                if (typeof text !== "string") throw Error("BLK-TYPE-009");
                answer += text;
                emit("model.chunk", moduleId, node.nodeId, {
                  summary: "产生输出",
                  outputType: "text",
                  outputBytes: utf8(text),
                });
                break;
              }
              case "core.agent":
                role = String(node.fields.ROLE);
                break;
              case "core.module.call": {
                const target = compiled.modules.find(
                  (m) => m.moduleId === node.fields.MODULE,
                );
                const root = target?.roots.find(
                  (n) =>
                    n.blockType === "core.tool.entry" &&
                    n.fields.EXPORT === node.fields.EXPORT,
                );
                if (!target || !root) throw Error("BLK-LINK-002");
                await execute(root, target.moduleId);
                break;
              }
              case "core.knowledge.retrieve": {
                const resource = resolveResource(
                  project,
                  String(node.fields.RESOURCE),
                  "knowledge",
                  options.userRegistry,
                );
                const contract = compiled.tools.find(
                  (t) =>
                    t.moduleId === moduleId &&
                    t.toolId === `tool-${moduleId}-${node.nodeId}`,
                );
                if (
                  !contract ||
                  ![...contract.permissions, "knowledge.read"].every((p) =>
                    capabilities.includes(p),
                  )
                )
                  throw Error("BLK-TOOL-001");
                const adapter = adapters.knowledge.get(
                  contract.implementationRef,
                );
                if (!adapter) throw Error("BLK-TOOL-002");
                const correlationId = `${runId}-${node.nodeId}-${runBudget.calls + 1}`;
                emit(
                  "tool.started",
                  moduleId,
                  node.nodeId,
                  { toolId: contract.toolId },
                  correlationId,
                );
                try {
                  runBudget.call();
                  const retrieved = await abortable(
                    adapter(
                      question,
                      String(resource.definition.collection),
                      signal,
                      { projectId: project.manifest.projectId, resource },
                    ),
                    signal,
                  );
                  citations = Array.isArray(retrieved)
                    ? retrieved
                    : retrieved.citations;
                  signal.throwIfAborted();
                  if (
                    !Array.isArray(citations) ||
                    citations.some(
                      (c) =>
                        typeof c.id !== "string" ||
                        typeof c.title !== "string" ||
                        typeof c.text !== "string",
                    )
                  )
                    throw Error("BLK-TOOL-003");
                  citations = citations.slice(0, 20);
                  emit(
                    "tool.completed",
                    moduleId,
                    node.nodeId,
                    {
                      resultCount: citations.length,
                      summary: "检索完成",
                    },
                    correlationId,
                  );
                } catch (error) {
                  emit(
                    "tool.failed",
                    moduleId,
                    node.nodeId,
                    {
                      code: signal.aborted ? "BLK-RUN-005" : safeCode(error),
                      summary: signal.aborted
                        ? "工具调用已取消"
                        : "工具调用失败",
                    },
                    correlationId,
                  );
                  throw error;
                }
                if (!citations.length)
                  emit("block.warning", moduleId, node.nodeId, {
                    code: "BLK-RUN-101",
                    summary: "资料不足，回答将标记待核实",
                  });
                break;
              }
              case "core.model.compose": {
                const resource = resolveResource(
                  project,
                  String(node.fields.RESOURCE),
                  "model",
                  options.userRegistry,
                );
                if (
                  !resource.capabilityRequirements.every((p) =>
                    capabilities.includes(p),
                  )
                )
                  throw Error("BLK-TOOL-001");
                const correlationId = `${runId}-${node.nodeId}-${runBudget.calls + 1}`;
                emit(
                  "model.started",
                  moduleId,
                  node.nodeId,
                  { summary: "整理资料" },
                  correlationId,
                );
                try {
                  if (
                    await agent.compose(
                      resource,
                      role,
                      citations,
                      correlationId,
                    )
                  ) {
                    const generation = agent.generations.at(-1);
                    emit(
                      "model.completed",
                      moduleId,
                      node.nodeId,
                      {
                        summary: "回答已生成",
                        transport:
                          generation?.transport ?? "local",
                        ...(generation?.usage ? { usage: generation.usage } : {}),
                        ...(generation ? { model: generation.model } : {}),
                      },
                      correlationId,
                    );
                    break;
                  }
                  const adapter = adapters.model.get(
                    implementationKey(resource.definition.implementationRef),
                  );
                  if (!adapter) throw Error("BLK-TOOL-002");
                  runBudget.call();
                  const proposed = await abortable(
                    adapter(
                      { question, role, citations: structuredClone(citations) },
                      signal,
                    ),
                    signal,
                  );
                  signal.throwIfAborted();
                  citations = proposed
                    .map((c) =>
                      citations.find(
                        (source) =>
                          source.id === c.id &&
                          source.text === c.text &&
                          source.title === c.title,
                      ),
                    )
                    .filter((c): c is Citation => !!c);
                  emit(
                    "model.completed",
                    moduleId,
                    node.nodeId,
                    { summary: "资料整理完成", transport: "local" },
                    correlationId,
                  );
                } catch (error) {
                  emit(
                    "model.failed",
                    moduleId,
                    node.nodeId,
                    {
                      code: signal.aborted ? "BLK-RUN-005" : safeCode(error),
                      summary: signal.aborted
                        ? "整理调用已取消"
                        : "整理调用失败",
                    },
                    correlationId,
                  );
                  throw error;
                }
                break;
              }
              case "core.output.answer":
                style = String(node.fields.STYLE);
                answer =
                  agent.generated ?? renderAnswer(citations, style, role);
                break;
            }
          if (node === root && node !== selectedEntry) await execute(startNode, moduleId);
          else if (node === selectedEntry && startNode === handlerHead && startNode !== selectedEntry)
            await execute(startNode, moduleId);
          else if (!handled && node.blockType !== "core.message.reply")
            for (const value of Object.values(node.inputs))
              for (const child of value
                ? Array.isArray(value)
                  ? value
                  : [value]
                : [])
                await execute(child, moduleId);
          emit("block.completed", moduleId, node.nodeId, {
            summary: "已完成",
            elapsedMs: Math.max(0, Math.floor(this.monotonicNow() - startedAt)),
            outputType: agent.value === null ? "null" : Array.isArray(agent.value) ? "array" : typeof agent.value,
            budget: {
              steps: runBudget.steps,
              calls: runBudget.calls,
              reservedOutputTokens: runBudget.usedOutput,
            },
          });
        } catch (error) {
          if (!signal.aborted)
            emit("block.failed", moduleId, node.nodeId, {
              code: safeCode(error),
              summary: "积木运行失败",
            });
          throw error;
        }
        if (node.next) await execute(node.next, moduleId);
      };
      await execute(root, module.moduleId);
      signal.throwIfAborted();
      emit("run.completed", undefined, undefined, { summary: "运行完成" });
    } catch (error) {
      status = signal.aborted && !runBudget.timeout ? "cancelled" : "failed";
      emit(
        status === "cancelled" ? "run.cancelled" : "run.failed",
        undefined,
        undefined,
        {
          code:
            status === "cancelled"
              ? "BLK-RUN-005"
              : runBudget.timeout
                ? "BLK-RUN-007"
                : safeCode(error),
          summary:
            status === "cancelled"
              ? "已停止"
              : "运行失败，请查看问题与运行日志",
        },
      );
    } finally {
      runBudget.dispose();
      await adapters.agent?.close?.(signal);
      this.running = false;
      this.paused = false;
      this.stepNext = false;
      this.breakpoints.clear();
    }
    return {
      status,
      answer,
      citations,
      events,
      ...(status === "completed"
        ? { structured: agent.structured, files: agent.files }
        : {}),
      generations: agent.generations,
      modelApiCalled: agent.generations.some((g) => g.transport === "remote"),
    };
  }
}
function findInNextChain(node: IrNode, id: string): IrNode | undefined {
  for (let current: IrNode | undefined = node; current; current = current.next)
    if (current.nodeId === id) return current;
  return undefined;
}
function findEntry(node: IrNode, id: string): IrNode | undefined {
  if (node.nodeId === id) return node;
  for (const value of Object.values(node.inputs)) {
    for (const child of value ? (Array.isArray(value) ? value : [value]) : []) {
      const found = findEntry(child, id);
      if (found) return found;
    }
  }
  return node.next ? findEntry(node.next, id) : undefined;
}
function safeCode(error: unknown) {
  return error instanceof Error && /^BLK-[A-Z0-9-]{3,64}$/.test(error.message)
    ? error.message
    : "BLK-RUN-201";
}
function wait(ms: number, signal: AbortSignal) {
  if (signal.aborted) return Promise.reject(signal.reason);
  if (ms <= 0) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const end = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
    };
    const abort = () => {
      end();
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      end();
      resolve();
    }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
}
