import {
  diagnostic,
  agentBudgetLimits,
  validateParallelNode,
  validateControlNode,
  assertRetrySafe,
  boundedField,
  workflowLayout,
  isWorkflowMarker,
  stableId,
  parseExpressionProgram,
  validRef,
  type Workspace,
  type WorkspaceBlock,
  type ModuleDescriptor,
  type ModuleIR,
  type Diagnostic,
  type IrNode,
  type SourceRef,
} from "@blocky/language-schema";
import { getBlock } from "@blocky/block-catalog";
import { isRpaSession, isRpaStep, compileRpaSession } from "@blocky/rpa-core";

function validateToolLoop(node: IrNode): void {
  if (node.fields.ENGINE !== undefined && !["blocky", "pi"].includes(String(node.fields.ENGINE))) throw Error("BLK-TOOL-LOOP-CONFIG");
  if (node.fields.SESSION !== undefined && !["turn", "conversation"].includes(String(node.fields.SESSION))) throw Error("BLK-TOOL-LOOP-CONFIG");
  boundedField(node.fields.MAX_TURNS, 1, agentBudgetLimits.turns);
  boundedField(node.fields.OUTPUT_TOKENS, 1, agentBudgetLimits.outputTokensPerTurn);
  let declaration = node.inputs.TOOLS;
  const resourceIds = new Set<string>();
  let count = 0;
  while (declaration) {
    if (
      Array.isArray(declaration) ||
      declaration.blockType !== "core.tool.expose" ||
      ++count > 16 ||
      typeof declaration.fields.RESOURCE !== "string" ||
      resourceIds.has(declaration.fields.RESOURCE)
    )
      throw Error("BLK-TOOL-LOOP-CONFIG");
    resourceIds.add(declaration.fields.RESOURCE);
    declaration = declaration.next ?? null;
  }
  if (!count && node.fields.ENGINE !== "pi") throw Error("BLK-TOOL-LOOP-CONFIG");
}

export function compileWorkspace(
  projectId: string,
  module: ModuleDescriptor,
  workspace: Workspace,
): { ir: ModuleIR; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [],
    sourceMap: Record<string, SourceRef> = {},
    ids = new Set<string>();
  const compile = (
    b: WorkspaceBlock,
    rpaScope = false,
    workflowScope = false,
    workflowActive = false,
    workflowRootAllowed = false,
    toolLoopScope = false,
  ): IrNode | null => {
    if (b.disabled)
      return b.next
        ? compile(
            b.next.block,
            rpaScope,
            workflowScope,
            workflowActive,
            workflowRootAllowed,
            toolLoopScope,
          )
        : null;
    const source = { projectId, moduleId: module.moduleId, blockId: b.id };
    if (
      (isWorkflowMarker(b.type) && !workflowScope) ||
      (b.type === "runtime.task.durable" && workflowActive)
    )
      diagnostics.push(
        diagnostic(
          "BLK-WORKFLOW-SCOPE",
          "工作流步骤须直接放在工作流中，不能嵌套工作流",
          source,
        ),
      );
    if (b.type === "runtime.task.durable" && !workflowRootAllowed)
      diagnostics.push(
        diagnostic(
          "BLK-WORKFLOW-SCOPE",
          "持久工作流须作为输入入口的完整处理流程",
          source,
        ),
      );
    if (isRpaStep(b.type) && !rpaScope)
      diagnostics.push(
        diagnostic(
          "BLK-RPA-SCOPE-001",
          "自动化操作必须放在已连接的窗口或浏览器中",
          source,
        ),
      );
    if (b.type === "core.tool.expose" && !toolLoopScope)
      diagnostics.push(
        diagnostic(
          "BLK-TOOL-LOOP-SCOPE",
          "提供给模型的工具只能放在工具循环的可用工具插槽中",
          source,
        ),
      );
    if (ids.has(b.id))
      diagnostics.push(diagnostic("BLK-TYPE-002", "积木 ID 重复", source));
    ids.add(b.id);
    sourceMap[b.id] = source;
    const def = getBlock(b.type),
      fields = b.fields ?? {};
    if (def && Object.keys(fields).some((field) => !def.fields.includes(field)))
      diagnostics.push(diagnostic("BLK-TYPE-007", "积木包含未知字段", source));
    for (const [field, options] of Object.entries(def?.fieldOptions ?? {}))
      if (
        options &&
        !(
          fields[field] === undefined && def?.optionalFields?.includes(field)
        ) &&
        !options.includes(String(fields[field]))
      )
        diagnostics.push(
          diagnostic("BLK-TYPE-009", `${field} 的选项无效`, source),
        );
    if (b.type === "core.knowledge.correct") {
      try {
        boundedField(fields.MAX_REWRITES, 0, 2);
      } catch {
        diagnostics.push(
          diagnostic("BLK-KNOWLEDGE-BUDGET", "最多改写次数须在 0–2 内", source),
        );
      }
    }
    if (["core.knowledge.chunk", "core.knowledge.sync"].includes(b.type)) {
      try {
        const size = boundedField(fields.SIZE, 1, 16000);
        boundedField(fields.OVERLAP, 0, size - 1);
      } catch {
        diagnostics.push(
          diagnostic(
            "BLK-KNOWLEDGE-BUDGET",
            "分段长度和重叠必须在支持范围内",
            source,
          ),
        );
      }
    }
    if (b.type === "core.data.set") {
      try {
        if (
          typeof fields.VALUE !== "string" ||
          new TextEncoder().encode(fields.VALUE).length > 32768
        )
          throw Error();
        JSON.parse(fields.VALUE);
      } catch {
        diagnostics.push(
          diagnostic("BLK-TYPE-009", "结果必须是有效且有界的 JSON", source),
        );
      }
    }
    if (
      b.type === "core.flow.delay" &&
      (typeof fields.MILLISECONDS !== "string" ||
        !/^\d+$/.test(fields.MILLISECONDS) ||
        Number(fields.MILLISECONDS) > 30000)
    )
      diagnostics.push(
        diagnostic("BLK-FLOW-002", "等待须在 0–30000 毫秒内", source),
      );
    if (b.type === "core.event.send" || b.type === "core.event.receive") {
      if (
        typeof fields.CHANNEL !== "string" ||
        fields.CHANNEL.length > 128 ||
        !stableId.test(fields.CHANNEL)
      )
        diagnostics.push(
          diagnostic("BLK-EVENT-001", "事件通道标识无效", source),
        );
      if (
        b.type === "core.event.receive" &&
        (typeof fields.TIMEOUT_MS !== "string" ||
          !/^\d+$/.test(fields.TIMEOUT_MS) ||
          Number(fields.TIMEOUT_MS) > 30000)
      )
        diagnostics.push(
          diagnostic("BLK-EVENT-001", "事件等待须在 0–30000 毫秒内", source),
        );
    }
    if (b.type === "core.run.budget")
      for (const [field, max] of [
        ["STEPS", agentBudgetLimits.steps],
        ["CALLS", agentBudgetLimits.calls],
        ["OUTPUT_TOKENS", agentBudgetLimits.outputTokens],
        ["TIMEOUT_MS", agentBudgetLimits.durationMs],
      ] as const) {
        const value = fields[field];
        if (
          typeof value !== "string" ||
          !/^\d+$/.test(value) ||
          Number(value) < 1 ||
          Number(value) > max
        )
          diagnostics.push(
            diagnostic("BLK-RUN-006", "运行预算必须在支持范围内", source),
          );
      }
    if (b.type === "core.data.transform") {
      try {
        parseExpressionProgram(fields.PROGRAM);
      } catch {
        diagnostics.push(
          diagnostic(
            "BLK-EXPR-001",
            "自定义计算的表达式无效或超出预算",
            source,
          ),
        );
      }
    }
    if (!def)
      diagnostics.push(diagnostic("BLK-TYPE-004", "未注册积木", source));
    else
      for (const field of def.fields)
        if (
          !def.optionalFields?.includes(field) &&
          (def.jsonFields?.includes(field)
            ? fields[field] === undefined
            : typeof fields[field] !== "string" || !fields[field])
        )
          diagnostics.push(
            diagnostic("BLK-TYPE-005", `请填写 ${field}`, source),
          );
    for (const field of ["MODULE", "EXPORT", "RESOURCE"])
      if (
        fields[field] !== undefined &&
        (typeof fields[field] !== "string" || !stableId.test(fields[field]))
      )
        diagnostics.push(diagnostic("BLK-TYPE-008", "引用标识无效", source));
    for (const field of ["INPUT", "OUTPUT"])
      if (
        fields[field] !== undefined &&
        (typeof fields[field] !== "string" || !validRef(fields[field]))
      )
        diagnostics.push(diagnostic("BLK-REF-001", "Schema 引用无效", source));
    const inputs: IrNode["inputs"] = {};
    for (const [name, value] of Object.entries(b.inputs ?? {})) {
      if (def && !def.inputs.includes(name))
        diagnostics.push(diagnostic("BLK-TYPE-007", "未知积木插槽", source));
      const child = value.block ?? value.shadow;
      const expected = def?.inputChecks?.[name];
      const childDef = child && getBlock(child.type);
      if (
        child &&
        expected &&
        !(Array.isArray(expected) ? expected : [expected]).includes(
          childDef?.output ??
            childDef?.statementCheck ??
            (childDef?.statement ? "step" : ""),
        )
      )
        diagnostics.push(
          diagnostic("BLK-TYPE-009", `插槽 ${name} 需要 ${expected}`, source),
        );
      inputs[name] = child
        ? compile(
            child,
            isRpaSession(b.type) && name === "STEPS",
            b.type === "runtime.task.durable" && name === "STEPS",
            workflowActive || b.type === "runtime.task.durable",
            b.type === "core.interaction.chat_entry" && name === "HANDLER",
            b.type === "core.reason.tool_loop" && name === "TOOLS",
          )
        : null;
    }
    for (const name of def?.requiredInputs ?? [])
      if (!inputs[name])
        diagnostics.push(diagnostic("BLK-TYPE-009", `请连接 ${name}`, source));
    if (
      b.next &&
      (def?.output ||
        (def?.statementCheck &&
          getBlock(b.next.block.type)?.statementCheck !== def.statementCheck) ||
        (!def?.statement && def?.inputChecks))
    )
      diagnostics.push(
        diagnostic("BLK-TYPE-009", "后续连接类型不兼容", source),
      );
    const next = b.next
      ? compile(
          b.next.block,
          rpaScope,
          workflowScope,
          workflowActive,
          b.type === "core.interaction.chat",
          toolLoopScope,
        )
      : null;
    const node: IrNode = {
      nodeId: b.id,
      blockType: b.type,
      fields,
      inputs,
      ...(next ? { next } : {}),
    };
    if (b.type === "core.flow.parallel") {
      try {
        validateParallelNode(node);
      } catch (error) {
        diagnostics.push(
          diagnostic(
            error instanceof Error ? error.message : "BLK-FLOW-001",
            "并行分支仅支持结果、条件、等待和受限嵌套；不能执行共享状态或外部副作用",
            source,
          ),
        );
      }
    }
    if (b.type === "core.reason.tool_loop") {
      try {
        validateToolLoop(node);
      } catch {
        diagnostics.push(
          diagnostic(
            "BLK-TOOL-LOOP-CONFIG",
            "工具循环须指定有效模型、1–8 轮及 1–16 个不同工具",
            source,
          ),
        );
      }
    }
    if (
      [
        "core.flow.repeat",
        "core.flow.foreach",
        "core.flow.while",
        "core.flow.try",
        "core.flow.retry",
      ].includes(b.type)
    ) {
      try {
        validateControlNode(node);
        if (b.type === "core.flow.retry") {
          const body = node.inputs.DO;
          if (!body || Array.isArray(body))
            throw Error("BLK-FLOW-RETRY-UNSAFE");
          assertRetrySafe(body);
        }
      } catch (error) {
        const code =
          error instanceof Error &&
          /^BLK-FLOW-(?:CONFIG|RETRY-UNSAFE)$/.test(error.message)
            ? error.message
            : "BLK-FLOW-CONFIG";
        diagnostics.push(
          diagnostic(
            code,
            code === "BLK-FLOW-RETRY-UNSAFE"
              ? "重试只允许已知无副作用的处理步骤"
              : "控制流程设置超出支持范围",
            source,
          ),
        );
      }
    }
    if (b.type === "runtime.task.durable") {
      try {
        workflowLayout(node);
      } catch {
        diagnostics.push(
          diagnostic(
            "BLK-WORKFLOW-SCOPE",
            "工作流须包含声明的执行步骤、审批或检查点；后续操作请放入步骤内",
            source,
          ),
        );
      }
    }
    if (isRpaSession(b.type)) {
      try {
        compileRpaSession(node, projectId);
      } catch (error) {
        diagnostics.push(
          diagnostic(
            error instanceof Error && /^BLK-RPA-/.test(error.message)
              ? error.message
              : "BLK-RPA-PLAN-001",
            "请检查自动化目标、定位器、步骤和输入来源",
            source,
          ),
        );
      }
    }
    return node;
  };
  const roots = workspace.blocks.blocks
    .map((block) => compile(block))
    .filter((n): n is IrNode => n !== null);
  return {
    ir: {
      schemaVersion: "blocky.module-ir/v1",
      projectId,
      moduleId: module.moduleId,
      roots,
      exports: module.exports,
      sourceMap,
    },
    diagnostics,
  };
}
