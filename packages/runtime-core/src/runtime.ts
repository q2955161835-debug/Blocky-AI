import {
  ingestionOptionsSchema,
  correctedQuery,
  resourceRetrieval,
  type SearchResult,
} from "@blocky/knowledge-core";
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
  agentMessageLimits,
  canonicalJson,
  digest,
  containsCredential,
  stableId,
  type IrNode,
  type Project,
  type Json,
  type Resource,
} from "@blocky/language-schema";
import {
  localAdapters,
  renderAnswer,
  type Adapters,
  type Citation,
} from "./adapters";
import { RunBudget, abortable, utf8, wait } from "./budget";
import { AgentExecution } from "./agent-execution";
import {newSessionLedger} from "./session-memory";
import { EventMailbox } from "./event-mailbox";
import { RpaExecution } from "./rpa-execution";
import { isRpaSession, isRpaStep } from "@blocky/rpa-core";
import type { Generation, OutputFile } from "./agent-context";
import {
  WorkflowExecution,
  WorkflowWaiting,
  type WorkflowSummary,
} from "./workflow/runtime";
import { resolveRunEntry } from "./entry";
import { parseRuntimeSession, type RuntimeSessionState } from "./session-state";
import { runToolLoop } from "./tool-loop";
import { runPiLoop, type PiConversation } from "./pi-loop";
import { delegateTasks, delegationSchema } from "./delegation";
import {executeSkill} from './skill-execution';
type Options = {
  sessionState?: unknown;
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
  private readonly sessionLedger = newSessionLedger();
  private readonly mailbox = new EventMailbox();
  private factory: EventFactory;
  private options: Options;
  private monotonicNow: () => number;
  private running = false;
  private sequence = 0;
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
    const state =
      options.sessionState === undefined
        ? undefined
        : parseRuntimeSession(options.sessionState);
    if (
      state &&
      (options.nextSequence ||
        (options.sessionId !== undefined &&
          options.sessionId !== state.sessionId))
    )
      throw Error("BLK-RUN-STATE");
    this.options = options;
    this.monotonicNow = options.monotonicNow ?? (() => performance.now());
    this.sessionId =
      state?.sessionId ?? options.sessionId ?? `session-${crypto.randomUUID()}`;
    this.sequence = state?.sequence ?? 0;
    if (state) {
      for (const item of state.memory)
        this.sessionMemory.set(
          JSON.stringify([item.projectId, this.sessionId, item.key]),
          item.value,
        );
      for(const item of state.memoryMetadata??[])this.sessionLedger.entries.set(JSON.stringify([item.projectId,this.sessionId,item.key]),item.entry);
      for(const item of state.revokedMemorySources??[])this.sessionLedger.revoked.add(JSON.stringify([item.projectId,this.sessionId,item.source]));
      this.mailbox.restoreSession(state.mailbox);
    }
    this.factory = new EventFactory(
      options.now,
      options.nextSequence,
      this.sequence,
    );
  }
  captureSession(): RuntimeSessionState {
    if (this.running) throw Error("BLK-RUN-STATE");
    return parseRuntimeSession({
      schemaVersion: "blocky.runtime-state/v1",
      sessionId: this.sessionId,
      sequence: this.sequence,
      memory: [...this.sessionMemory].map(([encoded, value]) => {
        const [projectId, sessionId, key] = JSON.parse(encoded);
        if (sessionId !== this.sessionId) throw Error("BLK-RUN-STATE");
        return { projectId, key, value };
      }),
      mailbox: this.mailbox.captureSession(),
      memoryMetadata:[...this.sessionLedger.entries].map(([encoded,entry])=>{const [projectId,sessionId,key]=JSON.parse(encoded);if(sessionId!==this.sessionId)throw Error('BLK-RUN-STATE');return {projectId,key,entry};}),
      revokedMemorySources:[...this.sessionLedger.revoked].map(encoded=>{const [projectId,sessionId,source]=JSON.parse(encoded);if(sessionId!==this.sessionId)throw Error('BLK-RUN-STATE');return {projectId,source};}),
    });
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
      workflowTaskId?: string;
      conversationId?: string;
      reasoningEffort?: "none" | "low" | "high" | "max";
    } = {},
  ): Promise<RunResult> {
    if (this.running) throw Error("BLK-RUN-003: 已有运行");
    if (options.conversationId !== undefined && (options.conversationId.length > 128 || !stableId.test(options.conversationId))) throw Error("BLK-RUN-STATE");
    if (options.reasoningEffort !== undefined && !["none", "low", "high", "max"].includes(options.reasoningEffort)) throw Error("BLK-RUN-STATE");
    const project = parseProject(input),
      runId = this.options.newId?.() ?? `run-${crypto.randomUUID()}`;
    // Reserve IDs synchronously, before an async adapter can observe shared budget changes.
    let requestSequence=0;
    const requestIdentity=()=>`${runId}-request-${++requestSequence}`;
    this.running = true;
    const breakpoints = options.debug?.breakpoints ?? [];
    if (
      breakpoints.some(
        ({ moduleId, blockId }) =>
          !/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(moduleId) ||
          !/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(blockId),
      )
    ) {
      this.running = false;
      throw Error("BLK-RUN-008");
    }
    this.breakpoints = new Set(
      breakpoints.map(({ moduleId, blockId }) =>
        JSON.stringify([moduleId, blockId]),
      ),
    );
    this.stepNext = false;
    const events: RuntimeEvent[] = [];
    const runBudget = new RunBudget(options.signal);
    const signal = runBudget.signal;
    const originalAdapters = this.options.adapters ?? localAdapters();
    const effort = options.reasoningEffort;
    // Scope the override to this invocation, including child agents and correction calls.
    const adapters = effort === undefined || !originalAdapters.agent?.generate ? originalAdapters : {
      ...originalAdapters,
      agent: { ...originalAdapters.agent, generate: (request: import("./agent-context").GenerationRequest, signal: AbortSignal) =>
        originalAdapters.agent!.generate!({ ...request, reasoningEffort: effort }, signal) },
    };
    let settlement: Promise<void> | undefined;
    const settle = () =>
      (settlement ??= Promise.resolve()
        .then(() => adapters.agent?.close?.(signal))
        .catch(() => {
          throw Error("BLK-RUN-SETTLEMENT");
        }));
    const rpa = new RpaExecution(
      adapters.rpa,
      project.manifest.projectId,
      signal,
    );
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
      this.sessionLedger,
    );
    type Scope = {
      answer: string;
      citations: Citation[];
      role: string;
      style: string;
    };
    const rootScope: Scope = {
      answer: "",
      citations: [],
      role: "",
      style: "条目",
    };
    const scopes = new WeakMap<AgentExecution, Scope>([[agent, rootScope]]);
    let status: RunResult["status"] = "completed";
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
      this.sequence = e.sequence;
      options.onEvent?.(e);
    };
    const workflow = new WorkflowExecution(
      adapters.workflow,
      project,
      options.userRegistry,
      agent,
      runBudget,
      () => ({ ...rootScope }),
      (value) => {
        Object.assign(rootScope, value);
        question = agent.question;
      },
      (value) =>
        emit(
          "checkpoint.created",
          value.moduleId,
          value.stepId ?? value.blockId,
          { summary: "工作流检查点已保存", checkpointId: value.taskId },
        ),
    );
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
      // These are available typed Host requests. The Host still checks its own
      // resource binding and asks for approval before any external effect.
      const baseCapabilities = this.options.capabilities ?? [
        "knowledge.read",
        "memory.read", "memory.write", "skill.read", "model.score", "media.read",
        ...(adapters.agent
          ? ["text.analyze", "module.execute", "network.request", "mcp.local", "workspace.read", "workspace.write", "workspace.check", "data.calculate"]
          : []),
      ];
      agent.allowedCapabilities = baseCapabilities;
      const invokeTool = async (
        resource: Resource,
        input: Json,
        requestId: string,
        state: AgentExecution,
      ): Promise<Json> => {
        const capabilities = state.allowedCapabilities ?? baseCapabilities;
        const permissions = resource.definition.permissions;
        if(state.activeSkillTools&&!state.activeSkillTools.includes(resource.resourceId))throw Error('BLK-SKILL-PERMISSION');
        if (
          !Array.isArray(permissions) ||
          ![...resource.capabilityRequirements, ...permissions].every(
            (p) => typeof p === "string" && capabilities.includes(p),
          )
        )
          throw Error("BLK-TOOL-001");
        if (
          implementationKey(resource.definition.implementationRef) !==
          "adapter://module-tool-v1"
        )
          return state.invokeTool(resource, input, requestId);
        const key = `${resource.definition.moduleId}:${resource.definition.exportId}`;
        if (state.toolPath.length >= 8 || state.toolPath.includes(key))
          throw Error("BLK-TOOL-RECURSION");
        return state.invokeTool(resource, input, requestId, async () => {
          const target = compiled.modules.find(
            (m) => m.moduleId === resource.definition.moduleId,
          );
          const exported = target?.exports.find(
            (e) =>
              e.kind === "tool" && e.exportId === resource.definition.exportId,
          );
          const entry = target?.roots.find(
            (n) =>
              n.blockType === "core.tool.entry" &&
              n.fields.EXPORT === resource.definition.exportId,
          );
          if (!target || !exported || !entry) throw Error("BLK-LINK-002");
          for (const field of ["inputSchemaRef", "outputSchemaRef"] as const) {
            const ref = resource.definition[field];
            const declared =
              ref &&
              typeof ref === "object" &&
              !Array.isArray(ref) &&
              ref.kind === "schema" &&
              typeof ref.id === "string"
                ? project.schemas[`schemas/${ref.id}.json`]
                : undefined;
            const linked = exported[field]
              ? project.schemas[exported[field]!]
              : undefined;
            if (
              !declared ||
              !linked ||
              canonicalJson(declared) !== canonicalJson(linked)
            )
              throw Error("BLK-LINK-004");
          }
          const child = state.forkTool(input);
          scopes.set(child, {
            answer: "",
            citations: [],
            role: "",
            style: "条目",
          });
          child.toolPath = [...state.toolPath, key];
          try {
            await execute(entry, target.moduleId, child);
            return child.structured ?? child.value;
          } finally {
            state.generations.push(...child.generations);
          }
        });
      };
      const module = compiled.modules.find(
        (m) => m.moduleId === entry.moduleId,
      )!;
      const root = module.roots.find((n) => n.nodeId === entry.ownerAgentId);
      const boundary = root && resolveRunEntry(root, entry.interactionId);
      if (!root || !boundary) throw Error("BLK-RUN-001");
      const { selectedEntry, handlerHead } = boundary;
      if (options.workflowTaskId !== undefined) {
        const workflowRoot = boundary.workflowRoot;
        if (
          typeof options.workflowTaskId !== "string" ||
          options.workflowTaskId.length > 128 ||
          !/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(options.workflowTaskId) ||
          workflowRoot?.blockType !== "runtime.task.durable"
        )
          throw Error("BLK-WORKFLOW-BINDING");
      }
      const startNode = options.debug?.startBlockId
        ? options.debug.startBlockId === handlerHead?.nodeId
          ? handlerHead
          : findInNextChain(selectedEntry, options.debug.startBlockId)
        : selectedEntry;
      if (!startNode) throw Error("BLK-RUN-009");
      if (
        startNode !== selectedEntry &&
        (selectedEntry === root
          ? startNode !== handlerHead
          : selectedEntry.next !== startNode)
      )
        throw Error("BLK-RUN-010");
      const pauseBoundary = async (moduleId?: string, blockId?: string) => {
        if (
          blockId &&
          this.breakpoints.has(JSON.stringify([moduleId, blockId]))
        ) {
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
      const execute = async (
        node: IrNode,
        moduleId: string,
        state: AgentExecution = agent,
      ): Promise<void> => {
        const capabilities = state.allowedCapabilities ?? baseCapabilities;
        const emitForTask:typeof emit=(type,moduleId,blockId,data,correlationId)=>emit(type,moduleId,blockId,{...(state.taskIdentity??{}),...data},correlationId);
        if(state.taskIdentity) {
          const needed=node.blockType.startsWith('core.memory.')?(node.blockType.endsWith('.read')||node.blockType.endsWith('.search')?'memory.read':'memory.write'):
            node.blockType==='core.module.call'?'module.execute':isRpaSession(node.blockType)||isRpaStep(node.blockType)?'rpa.execute':undefined;
          if(needed&&!capabilities.includes(needed))throw Error('BLK-AGENT-PERMISSION');
        }
        let scope = scopes.get(state);
        if (!scope) {
          scope = { answer: "", citations: [], role: "", style: "条目" };
          scopes.set(state, scope);
        }
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
        emitForTask("block.started", moduleId, node.nodeId, {
          summary: "正在运行",
          blockType: node.blockType,
          inputPorts: Object.keys(node.inputs).sort(),
        });
        let details: TraceDetails | undefined;
        const reportDetails = (value: TraceDetails) => {
          details = structuredClone(value);
          if (value.rpa?.phase === "authorized")
            emitForTask("checkpoint.created", moduleId, node.nodeId, {
              summary: "自动化会话已授权，检查点已建立",
              checkpointId: value.rpa.checkpointId!,
            });
        };
        try {
          await wait(this.options.delayMs ?? 0, signal);
          signal.throwIfAborted();
          if (!stepped) stepped = await pauseBoundary();
          let handled: boolean;
          const toolCall =
            node.blockType === "core.tool.invoke" || isRpaStep(node.blockType);
          if (isRpaSession(node.blockType))
            emitForTask("tool.permission-requested", moduleId, node.nodeId, {
              summary: "等待审阅自动化目标与操作",
            });
          const toolCorrelation = requestIdentity();
          if (toolCall)
            emitForTask(
              "tool.started",
              moduleId,
              node.nodeId,
              { toolId: `tool-${moduleId}-${node.nodeId}` },
              toolCorrelation,
            );
          try {
            if (isRpaSession(node.blockType) || isRpaStep(node.blockType))
              runBudget.call();
            if(await executeSkill(node,state,capabilities,(r,input,id)=>invokeTool(r,input,id,state))) {
              emitForTask('tool.completed',moduleId,node.nodeId,{summary:'Skill 操作完成',operation:node.blockType});handled=true;
            }else if (node.blockType === "core.agent.delegate") {
              let tasks:unknown;try{tasks=JSON.parse(String(node.fields.TASKS));}catch{throw Error("BLK-AGENT-CONFIG");}
              const parsed=delegationSchema.safeParse({tasks,mode:node.fields.MODE,failurePolicy:node.fields.FAILURE});
              if(!parsed.success)throw Error("BLK-AGENT-CONFIG");
              const parentTaskId=state.taskIdentity?.taskId??runId;
              state.value=await delegateTasks({spec:parsed.data,parentTaskId,capabilities,input:node.fields.SOURCE==='input'?state.question:state.value,budget:runBudget,
                resolve:id=>resolveResource(project,id,"tool",options.userRegistry),
                invoke:async(task,resource,input)=>{
                  const child=state.forkTool(input);child.allowedCapabilities=task.permissions;child.taskIdentity=task;child.instruction+='\n'+task.instruction;
                  try{return await invokeTool(resource,input,task.taskId,child);}finally{state.generations.push(...child.generations);}
                },
                event:(task,status,code)=>emitForTask(status==='started'?'tool.started':status==='completed'?'tool.completed':'tool.failed',moduleId,node.nodeId,
                  {summary:status==='started'?'子任务开始':status==='completed'?'子任务完成':'子任务失败',taskId:task.taskId,parentTaskId:task.parentTaskId,agentId:task.agentId,resourceId:task.resourceId,...(code?{code}:{})},task.taskId),
              }) as unknown as Json;
              state.structured=state.value;
              state.generated=canonicalJson(state.value);
              handled=true;
            } else if (node.blockType === "runtime.task.durable") {
              if (state !== agent) throw Error("BLK-WORKFLOW-SCOPE");
              await workflow.execute(
                node,
                moduleId,
                (child) => execute(child, moduleId, state),
                options.workflowTaskId,
              );
              handled = true;
            } else
              handled = await rpa.execute(
                node,
                moduleId,
                state,
                (child) => execute(child, moduleId, state),
                reportDetails,
              );
            if (!handled)
              handled = await state.execute(
                node,
                (child, branch = state) => execute(child, moduleId, branch),
                reportDetails,
                (resource, input, requestId) =>
                  invokeTool(resource, input, requestId, state),
              );
            if (toolCall)
              emitForTask(
                "tool.completed",
                moduleId,
                node.nodeId,
                { summary: "工具运行完成", ...(details ? { details } : {}) },
                toolCorrelation,
              );
          } catch (error) {
            if (toolCall)
              emitForTask(
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
                  emitForTask("block.started", moduleId, value.nodeId, {
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
                      : JSON.parse(state.question);
                    result = evaluateExpression(value.fields.PROGRAM, input);
                  } else if (value.blockType === "core.message.create") {
                    const content = await evaluate(value.inputs.CONTENT);
                    result =
                      typeof content === "string"
                        ? content
                        : JSON.stringify(content);
                  } else throw Error("BLK-TYPE-009");
                  signal.throwIfAborted();
                  emitForTask("block.completed", moduleId, value.nodeId, {
                    summary: "已完成",
                    elapsedMs: Math.max(
                      0,
                      Math.floor(this.monotonicNow() - expressionStartedAt),
                    ),
                    outputType:
                      result === null
                        ? "null"
                        : Array.isArray(result)
                          ? "array"
                          : typeof result,
                  });
                  return result;
                };
                const text = await evaluate(node.inputs.MESSAGE);
                if (typeof text !== "string") throw Error("BLK-TYPE-009");
                scope.answer += text;
                emitForTask("model.chunk", moduleId, node.nodeId, {
                  summary: "产生输出",
                  outputType: "text",
                  outputBytes: utf8(text),
                });
                break;
              }
              case "core.agent":
                scope.role = String(node.fields.ROLE);
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
              case "core.knowledge.source":
              case "core.knowledge.parse":
              case "core.knowledge.chunk":
              case "core.knowledge.sync":
              case "core.knowledge.embed":
              case "core.knowledge.index": {
                const resource = resolveResource(
                  project,
                  String(node.fields.RESOURCE),
                  "knowledge",
                  options.userRegistry,
                );
                if (
                  !["knowledge.read", ...resource.capabilityRequirements].every(
                    (permission) => capabilities.includes(permission),
                  )
                )
                  throw Error("BLK-TOOL-001");
                if (!adapters.knowledgeOperation) throw Error("BLK-TOOL-002");
                runBudget.call();
                const stage = node.blockType
                  .split(".")
                  .at(-1) as import("@blocky/knowledge-core").KnowledgeStage;
                emitForTask("tool.started", moduleId, node.nodeId, {
                  summary: "正在处理知识来源",
                  stage,
                });
                state.value = await abortable(
                  adapters.knowledgeOperation(
                    {
                      projectId: project.manifest.projectId,
                      resource,
                      stage,
                      options: ingestionOptionsSchema.parse({
                        ...(["chunk", "sync"].includes(stage)
                          ? {
                              size: Number(node.fields.SIZE),
                              overlap: Number(node.fields.OVERLAP),
                            }
                          : {}),
                        ...(stage === "embed"
                          ? { modelId: String(node.fields.MODEL) }
                          : {}),
                      }),
                    },
                    signal,
                  ),
                  signal,
                );
                signal.throwIfAborted();
                if (utf8(canonicalJson(state.value)) > 32768)
                  throw Error("BLK-KNOWLEDGE-BUDGET");
                emitForTask("tool.completed", moduleId, node.nodeId, {
                  summary: "知识处理阶段完成",
                  stage,
                });
                break;
              }
              case "core.knowledge.correct": {
                const resource = resolveResource(
                  project,
                  String(node.fields.RESOURCE),
                  "knowledge",
                  options.userRegistry,
                );
                const model = resolveResource(
                  project,
                  String(node.fields.MODEL),
                  "model",
                  options.userRegistry,
                );
                if (
                  ![
                    "knowledge.read",
                    ...resource.capabilityRequirements,
                    ...model.capabilityRequirements,
                  ].every((permission) => capabilities.includes(permission))
                )
                  throw Error("BLK-TOOL-001");
                const adapter = adapters.knowledge.get(
                  implementationKey(resource.definition.implementationRef),
                );
                if (!adapter) throw Error("BLK-TOOL-002");
                let lastQuery = state.question;
                const query = async (
                  question: string,
                  _options: unknown,
                  operationSignal = signal,
                ) => {
                  operationSignal.throwIfAborted();
                  runBudget.call();
                  lastQuery = question;
                  const reply = await adapter(
                    question,
                    String(resource.definition.collection),
                    operationSignal,
                    { projectId: project.manifest.projectId, resource },
                  );
                  if (
                    Array.isArray(reply) ||
                    !reply.searchResult ||
                    reply.searchResult.citations.some(
                      (citation) =>
                        citation.collectionId !==
                        resource.definition.collection,
                    )
                  )
                    throw Error("BLK-KNOWLEDGE-QUERY");
                  return reply.searchResult;
                };
                const retrieved = await abortable(
                  correctedQuery(
                    {
                      query,
                      assertCurrent: async (
                        result: SearchResult,
                        operationSignal: AbortSignal,
                      ) => {
                        const current = await query(
                          lastQuery,
                          {},
                          operationSignal,
                        );
                        if (
                          current.indexRevision !== result.indexRevision ||
                          current.generation !== result.generation
                        )
                          throw Error("BLK-KNOWLEDGE-CONFLICT");
                      },
                    },
                    state.question,
                    resourceRetrieval(resource.definition),
                    async (input, operationSignal) => {
                      operationSignal.throwIfAborted();
                      const judgment = await state.judgeKnowledge(model, input);
                      emitForTask("model.completed", moduleId, node.nodeId, {
                        summary: "证据相关性检查完成",
                        transport: state.generations.at(-1)!.transport,
                        model: state.generations.at(-1)!.model,
                      });
                      return judgment;
                    },
                    Number(node.fields.MAX_REWRITES),
                    signal,
                  ),
                  signal,
                );
                scope.citations = retrieved.citations;
                state.value = {
                  status: retrieved.status,
                  ...retrieved.correction,
                };
                if (!scope.citations.length)
                  emitForTask("block.warning", moduleId, node.nodeId, {
                    code: "BLK-RUN-101",
                    summary: "证据不足，请补充资料或澄清问题",
                  });
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
                const correlationId = requestIdentity();
                emitForTask(
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
                      state.question,
                      String(resource.definition.collection),
                      signal,
                      { projectId: project.manifest.projectId, resource },
                    ),
                    signal,
                  );
                  scope.citations = Array.isArray(retrieved)
                    ? retrieved
                    : retrieved.citations;
                  signal.throwIfAborted();
                  if (
                    !Array.isArray(scope.citations) ||
                    scope.citations.some(
                      (c) =>
                        typeof c.id !== "string" ||
                        typeof c.title !== "string" ||
                        typeof c.text !== "string",
                    )
                  )
                    throw Error("BLK-TOOL-003");
                  scope.citations = scope.citations.slice(0, 20);
                  emitForTask(
                    "tool.completed",
                    moduleId,
                    node.nodeId,
                    {
                      resultCount: scope.citations.length,
                      summary: "检索完成",
                    },
                    correlationId,
                  );
                } catch (error) {
                  emitForTask(
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
                if (!scope.citations.length)
                  emitForTask("block.warning", moduleId, node.nodeId, {
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
                const correlationId = requestIdentity();
                emitForTask(
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
                      scope.role,
                      scope.citations,
                      correlationId,
                      reportDetails,
                    )
                  ) {
                    const generation =
                      state.generations.length > generationCount
                        ? state.generations.at(-1)
                        : undefined;
                    emitForTask(
                      "model.completed",
                      moduleId,
                      node.nodeId,
                      {
                        summary: "回答已生成",
                        transport: generation?.transport ?? "local",
                        ...(generation?.usage
                          ? { usage: generation.usage }
                          : {}),
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
                      {
                        question: state.question,
                        role: scope.role,
                        citations: structuredClone(scope.citations),
                      },
                      signal,
                    ),
                    signal,
                  );
                  signal.throwIfAborted();
                  scope.citations = proposed
                    .map((c) =>
                      scope.citations.find(
                        (source) =>
                          source.id === c.id &&
                          source.text === c.text &&
                          source.title === c.title,
                      ),
                    )
                    .filter((c): c is Citation => !!c);
                  emitForTask(
                    "model.completed",
                    moduleId,
                    node.nodeId,
                    { summary: "资料整理完成", transport: "local" },
                    correlationId,
                  );
                } catch (error) {
                  emitForTask(
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
              case "core.reason.tool_loop": {
                await state.refreshMemoryContext();
                const resource = resolveResource(
                  project,
                  String(node.fields.RESOURCE),
                  "model",
                  options.userRegistry,
                );
                if (
                  !resource.capabilityRequirements.every((p) =>
                    capabilities.includes(p),
                  ) ||
                  !Array.isArray(resource.definition.capabilities) ||
                  (!resource.definition.capabilities.includes("tools") && (node.inputs.TOOLS || node.fields.ENGINE !== "pi")) ||
                  !state.services.generate
                )
                  throw Error("BLK-TOOL-001");
                const resourceIds: string[] = [];
                let declaration = node.inputs.TOOLS;
                while (declaration) {
                  if (
                    Array.isArray(declaration) ||
                    declaration.blockType !== "core.tool.expose" ||
                    resourceIds.length >= 16
                  )
                    throw Error("BLK-TOOL-LOOP-CONFIG");
                  resourceIds.push(String(declaration.fields.RESOURCE));
                  if(state.activeSkillTools&&!state.activeSkillTools.includes(String(declaration.fields.RESOURCE)))throw Error('BLK-SKILL-PERMISSION');
                  declaration = declaration.next ?? null;
                }
                const pi = node.fields.ENGINE === "pi";
                const conversationKey = JSON.stringify([project.manifest.projectId, this.sessionId, `pi-${(await digest(options.conversationId === undefined ? [moduleId, node.nodeId] : [moduleId, node.nodeId, options.conversationId])).slice(0, 32)}`]);
                const binding = await digest({ model: resource, ...(effort === undefined ? {} : { reasoningEffort: effort }), role: scope.role, instruction: state.instruction, tools: resourceIds.map((id) => resolveResource(project, id, "tool", options.userRegistry)), citations: scope.citations });
                const stored = this.sessionMemory.get(conversationKey);
                let conversation: PiConversation = [];
                if (pi && node.fields.SESSION === "conversation" && stored && typeof stored === "object" && !Array.isArray(stored) && stored.binding === binding && Array.isArray(stored.messages)) conversation = stored.messages as PiConversation;
                const loop = pi ? (context: Parameters<typeof runToolLoop>[0]) => runPiLoop(context, conversation) : runToolLoop;
                state.generated = await loop({
                  project,
                  registry: options.userRegistry,
                  ...(effort === undefined ? {} : { reasoningEffort: effort }),
                  model: resource,
                  budget: runBudget,
                  capabilities,
                  requestId: requestIdentity(),
                  question: state.question,
                  role: scope.role,
                  instruction: state.instruction,
                  memory: state.memory,
                  value: state.value,
                  citations: scope.citations,
                  requireEvidence: state.requireEvidence,
                  resourceIds,
                  maxTurns: Number(node.fields.MAX_TURNS),
                  outputPerTurn: Number(node.fields.OUTPUT_TOKENS),
                  generate:async(request,signal)=>{await state.refreshMemoryContext();const result=await state.services.generate!(request,signal);try{await state.refreshMemoryContext();}catch(error){state.generations.push({...result,text:'',toolCalls:[]});throw error;}return result;},
                  invoke: (tool, input, id) =>
                    invokeTool(tool, input, id, state),
                  onGeneration: (value) =>
                    state.generations.push({
                      ...value,
                      text: "",
                      toolCalls: [],
                    }),
                  onEvent: (value) =>
                    emitForTask(
                      value.type,
                      moduleId,
                      node.nodeId,
                      value.data,
                      value.requestId,
                    ),
                  ...(state.services.validateCitations
                    ? {
                        validateCitations: (signal: AbortSignal) =>
                          state.services.validateCitations!(
                            project.manifest.projectId,
                            scope.citations,
                            signal,
                          ),
                      }
                    : {}),
                });
                if (pi && node.fields.SESSION === "conversation") {
                  const next = ([...conversation, { role: "user", content: state.question }, { role: "assistant", content: state.generated }] as PiConversation).slice(-20);
                  while (utf8(canonicalJson(next)) > agentMessageLimits.historyBytes && next.length > 2) next.splice(0, 2);
                  if (utf8(canonicalJson(next)) <= agentMessageLimits.historyBytes && !containsCredential(canonicalJson(next))) {
                    const entry = { binding, messages: next } as Json;
                    const future = new Map(this.sessionMemory); future.set(conversationKey, entry);
                    if (utf8(canonicalJson([...future])) <= agentMessageLimits.sessionBytes) this.sessionMemory.set(conversationKey, entry);
                  }
                }
                state.value = state.generated;
                handled = true;
                break;
              }
              case "core.output.answer":
                await state.refreshMemoryContext();
                scope.style = String(node.fields.STYLE);
                scope.answer =
                  state.generated ??
                  renderAnswer(scope.citations, scope.style, scope.role);
                break;
            }
          if (node === root && node !== selectedEntry)
            await execute(startNode, moduleId, state);
          else if (
            node === selectedEntry &&
            startNode === handlerHead &&
            startNode !== selectedEntry
          )
            await execute(startNode, moduleId, state);
          else if (!handled && node.blockType !== "core.message.reply")
            for (const value of Object.values(node.inputs))
              for (const child of value
                ? Array.isArray(value)
                  ? value
                  : [value]
                : [])
                await execute(child, moduleId, state);
          emitForTask("block.completed", moduleId, node.nodeId, {
            summary: "已完成",
            elapsedMs: Math.max(0, Math.floor(this.monotonicNow() - startedAt)),
            ...(details ? { details } : {}),
            outputType:
              state.value === null
                ? "null"
                : Array.isArray(state.value)
                  ? "array"
                  : typeof state.value,
            budget: {
              steps: runBudget.steps,
              calls: runBudget.calls,
              reservedOutputTokens: runBudget.usedOutput,
            },
          });
        } catch (error) {
          if (!signal.aborted && !(error instanceof WorkflowWaiting))
            emitForTask("block.failed", moduleId, node.nodeId, {
              code: safeCode(error),
              summary: "积木运行失败",
              ...(details ? { details } : {}),
            });
          throw error;
        }
        if (stepped && this.paused)
          emitForTask("run.paused", moduleId, node.nodeId, {
            summary: "单步已完成",
            blockId: node.nodeId,
          });
        if (node.next) await execute(node.next, moduleId, state);
      };
      await execute(root, module.moduleId);
      signal.throwIfAborted();
      await settle();
      emit("run.completed", undefined, undefined, { summary: "运行完成" });
    } catch (error) {
      try {
        await settle();
      } catch (failure) {
        error = failure;
      }
      if (error instanceof WorkflowWaiting && !signal.aborted) {
        status = "waiting";
        emit(
          "run.paused",
          workflow.result?.moduleId,
          workflow.result?.blockId,
          {
            reason: "workflow-waiting",
            summary:
              workflow.result?.status === "awaiting-approval"
                ? "工作流等待业务审批"
                : "工作流已保存并暂停",
          },
        );
      } else {
        const settlementFailed = [
          "BLK-RPA-SETTLEMENT-001",
          "BLK-RUN-SETTLEMENT",
        ].includes(safeCode(error));
        status =
          signal.aborted && !runBudget.timeout && !settlementFailed
            ? "cancelled"
            : "failed";
        emit(
          status === "cancelled" ? "run.cancelled" : "run.failed",
          undefined,
          undefined,
          {
            code: settlementFailed
              ? safeCode(error)
              : status === "cancelled"
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
      this.running = false;
      this.paused = false;
      this.stepNext = false;
      this.breakpoints.clear();
    }
    return {
      status,
      answer: rootScope.answer,
      citations: rootScope.citations,
      events,
      ...(status === "completed"
        ? { structured: agent.structured, files: agent.files }
        : {}),
      generations: agent.generations,
      modelApiCalled: agent.generations.some((g) => g.transport === "remote"),
      ...(workflow.result ? { workflow: workflow.result } : {}),
    };
  }
}
function findInNextChain(node: IrNode, id: string): IrNode | undefined {
  for (let current: IrNode | undefined = node; current; current = current.next)
    if (current.nodeId === id) return current;
  return undefined;
}
function safeCode(error: unknown) {
  return error instanceof Error && /^BLK-[A-Z0-9-]{3,64}$/.test(error.message)
    ? error.message
    : "BLK-RUN-201";
}
