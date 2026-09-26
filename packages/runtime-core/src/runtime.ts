import { resolveResource, implementationKey } from "@blocky/resource-registry";
import { compileProject } from "@blocky/compiler";
import {
  EventFactory,
  type RuntimeEvent,
  type EventType,
  type TraceDetails,
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
import { RunBudget, abortable, utf8, wait } from "./budget";
import { AgentExecution } from "./agent-execution";
import { EventMailbox } from "./event-mailbox";
import { RpaExecution } from "./rpa-execution";
import { isRpaSession, isRpaStep } from "@blocky/rpa-core";
import type { Generation, OutputFile } from "./agent-context";
import { WorkflowExecution,WorkflowWaiting,type WorkflowSummary } from "./workflow/runtime";
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
  status: "completed" | "failed" | "cancelled" | "waiting";
  answer: string;
  citations: Citation[];
  events: RuntimeEvent[];
  structured?: Json;
  files?: OutputFile[];
  generations?: Generation[];
  modelApiCalled?: boolean;
  workflow?: WorkflowSummary;
};
export class Runtime {
  private readonly sessionId: string;
  private readonly sessionMemory = new Map<string, Json>();
  private readonly mailbox = new EventMailbox();
  private factory: EventFactory;
  private options: Options;
  private monotonicNow: () => number;
  private running = false;
  private paused = false;
  private stepNext = false;
  private breakpoints = new Set<string>();
  pause() {
    if (this.running) {
      this.paused = true;
      this.stepNext = false;
    }
  }
  resume() {
    this.paused = false;
    this.stepNext = false;
  }
  step() {
    if (this.running && this.paused) {
      this.stepNext = true;
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
      workflowTaskId?:string;
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
    const rpa = new RpaExecution(adapters.rpa, project.manifest.projectId, signal);
    const agent = new AgentExecution(
      project,
      question,
      runId,
      this.sessionId,
      runBudget,
      adapters.agent,
      options.userRegistry,
      this.sessionMemory,
      this.mailbox,
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
    const workflow=new WorkflowExecution(adapters.workflow,project,options.userRegistry,agent,runBudget,
      ()=>({answer,citations,role,style}),value=>{answer=value.answer;citations=value.citations;role=value.role;style=value.style;question=agent.question;},
      value=>emit("checkpoint.created",value.moduleId,value.stepId??value.blockId,{summary:"工作流检查点已保存",checkpointId:value.taskId}));
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
      if(options.workflowTaskId!==undefined){
        const workflowRoot=handlerHead??selectedEntry.next;
        if(typeof options.workflowTaskId!=="string"||options.workflowTaskId.length>128||!/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(options.workflowTaskId)||workflowRoot?.blockType!=="runtime.task.durable")throw Error("BLK-WORKFLOW-BINDING");
      }
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
        if (blockId && this.breakpoints.has(JSON.stringify([moduleId, blockId]))) {
          this.paused = true;
        }
        if (!this.paused) return false;
        emit("run.paused", moduleId, blockId, {
          summary: "运行已暂停",
          ...(blockId ? { blockId } : {}),
        });
        while (this.paused && !this.stepNext) {
          await wait(20, signal);
        }
        signal.throwIfAborted();
        // One permit is consumed synchronously; other parallel waiters stay paused.
        const stepped = this.paused && this.stepNext;
        if (stepped) this.stepNext = false;
        emit("run.resumed", moduleId, blockId, { summary: "运行已继续" });
        return stepped;
      };
      const execute = async (node: IrNode, moduleId: string, state: AgentExecution = agent): Promise<void> => {
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
        let stepped = await pauseBoundary(moduleId, node.nodeId);
        runBudget.step();
        emit("block.started", moduleId, node.nodeId, {
          summary: "正在运行",
          blockType: node.blockType,
          inputPorts: Object.keys(node.inputs).sort(),
        });
        let details: TraceDetails | undefined;
        const reportDetails = (value: TraceDetails) => {
          details = structuredClone(value);
          if (value.rpa?.phase === "authorized") emit("checkpoint.created", moduleId, node.nodeId, { summary: "自动化会话已授权，检查点已建立", checkpointId: value.rpa.checkpointId! });
        };
        try {
          await wait(this.options.delayMs ?? 0, signal);
          signal.throwIfAborted();
          if (!stepped) stepped = await pauseBoundary();
          let handled: boolean;
          const toolCall = node.blockType === "core.tool.invoke" || isRpaStep(node.blockType);
          if (isRpaSession(node.blockType)) emit("tool.permission-requested", moduleId, node.nodeId, { summary: "等待审阅自动化目标与操作" });
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
            if (isRpaSession(node.blockType) || isRpaStep(node.blockType)) runBudget.call();
            if(node.blockType==="runtime.task.durable"){
              if(state!==agent)throw Error("BLK-WORKFLOW-SCOPE");
              await workflow.execute(node,moduleId,child=>execute(child,moduleId,state),options.workflowTaskId);handled=true;
            }else handled = await rpa.execute(node, moduleId, state, child => execute(child, moduleId, state), reportDetails);
            if (!handled) handled = await state.execute(node, (child, branch = state) => execute(child, moduleId, branch), reportDetails);
            if (toolCall)
              emit(
                "tool.completed",
                moduleId,
                node.nodeId,
                { summary: "工具运行完成", ...(details ? { details } : {}) },
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
                  ...(details ? { details } : {}),
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
                await execute(root, target.moduleId, state);
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
                  const generationCount = state.generations.length;
                  if (
                    await state.compose(
                      resource,
                      role,
                      citations,
                      correlationId,
                      reportDetails,
                    )
                  ) {
                    const generation = state.generations.length > generationCount ? state.generations.at(-1) : undefined;
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
                        ...(details ? { details } : {}),
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
                      ...(details ? { details } : {}),
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
                  state.generated ?? renderAnswer(citations, style, role);
                break;
            }
          if (node === root && node !== selectedEntry) await execute(startNode, moduleId, state);
          else if (node === selectedEntry && startNode === handlerHead && startNode !== selectedEntry)
            await execute(startNode, moduleId, state);
          else if (!handled && node.blockType !== "core.message.reply")
            for (const value of Object.values(node.inputs))
              for (const child of value
                ? Array.isArray(value)
                  ? value
                  : [value]
                : [])
                await execute(child, moduleId, state);
          emit("block.completed", moduleId, node.nodeId, {
            summary: "已完成",
            elapsedMs: Math.max(0, Math.floor(this.monotonicNow() - startedAt)),
            ...(details ? { details } : {}),
            outputType: state.value === null ? "null" : Array.isArray(state.value) ? "array" : typeof state.value,
            budget: {
              steps: runBudget.steps,
              calls: runBudget.calls,
              reservedOutputTokens: runBudget.usedOutput,
            },
          });
        } catch (error) {
          if (!signal.aborted && !(error instanceof WorkflowWaiting))
            emit("block.failed", moduleId, node.nodeId, {
              code: safeCode(error),
              summary: "积木运行失败",
              ...(details ? { details } : {}),
            });
          throw error;
        }
        if (stepped && this.paused)
          emit("run.paused", moduleId, node.nodeId, { summary: "单步已完成", blockId: node.nodeId });
        if (node.next) await execute(node.next, moduleId, state);
      };
      await execute(root, module.moduleId);
      signal.throwIfAborted();
      emit("run.completed", undefined, undefined, { summary: "运行完成" });
    } catch (error) {
      if(error instanceof WorkflowWaiting&&!signal.aborted){
        status="waiting";emit("run.paused",workflow.result?.moduleId,workflow.result?.blockId,{summary:workflow.result?.status==="awaiting-approval"?"工作流等待业务审批":"工作流已保存并暂停"});
      }else{
      const settlementFailed = safeCode(error) === "BLK-RPA-SETTLEMENT-001";
      status = signal.aborted && !runBudget.timeout && !settlementFailed ? "cancelled" : "failed";
      emit(
        status === "cancelled" ? "run.cancelled" : "run.failed",
        undefined,
        undefined,
        {
          code:
            settlementFailed ? "BLK-RPA-SETTLEMENT-001" : status === "cancelled"
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
      }
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
      ...(workflow.result?{workflow:workflow.result}:{}),
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
