import {
  diagnostic,
  validateParallelNode,
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
export function compileWorkspace(
  projectId: string,
  module: ModuleDescriptor,
  workspace: Workspace,
): { ir: ModuleIR; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [],
    sourceMap: Record<string, SourceRef> = {},
    ids = new Set<string>();
  const compile = (b: WorkspaceBlock, rpaScope = false, workflowScope=false, workflowActive=false,workflowRootAllowed=false): IrNode | null => {
    if (b.disabled) return b.next ? compile(b.next.block, rpaScope,workflowScope,workflowActive,workflowRootAllowed) : null;
    const source = { projectId, moduleId: module.moduleId, blockId: b.id };
    if((isWorkflowMarker(b.type)&&!workflowScope)||(b.type==="runtime.task.durable"&&workflowActive))diagnostics.push(diagnostic("BLK-WORKFLOW-SCOPE","工作流步骤须直接放在工作流中，不能嵌套工作流",source));
    if(b.type==="runtime.task.durable"&&!workflowRootAllowed)diagnostics.push(diagnostic("BLK-WORKFLOW-SCOPE","持久工作流须作为输入入口的完整处理流程",source));
    if (isRpaStep(b.type) && !rpaScope) diagnostics.push(diagnostic("BLK-RPA-SCOPE-001", "自动化操作必须放在已连接的窗口或浏览器中", source));
    if (ids.has(b.id))
      diagnostics.push(diagnostic("BLK-TYPE-002", "积木 ID 重复", source));
    ids.add(b.id);
    sourceMap[b.id] = source;
    const def = getBlock(b.type),
      fields = b.fields ?? {};
    if (def && Object.keys(fields).some(field=>!def.fields.includes(field))) diagnostics.push(diagnostic('BLK-TYPE-007','积木包含未知字段',source));
    for (const [field, options] of Object.entries(def?.fieldOptions ?? {}))
      if (options && !(fields[field] === undefined && def?.optionalFields?.includes(field)) && !options.includes(String(fields[field]))) diagnostics.push(diagnostic('BLK-TYPE-009',`${field} 的选项无效`,source));
    if (b.type === 'core.data.set') {
      try { if (typeof fields.VALUE !== 'string' || new TextEncoder().encode(fields.VALUE).length>32768) throw Error(); JSON.parse(fields.VALUE); }
      catch { diagnostics.push(diagnostic('BLK-TYPE-009','结果必须是有效且有界的 JSON',source)); }
    }
    if (b.type === "core.flow.delay" && (typeof fields.MILLISECONDS !== "string" || !/^\d+$/.test(fields.MILLISECONDS) || Number(fields.MILLISECONDS) > 30000))
      diagnostics.push(diagnostic("BLK-FLOW-002", "等待须在 0–30000 毫秒内", source));
    if (b.type === "core.event.send" || b.type === "core.event.receive") {
      if (typeof fields.CHANNEL !== "string" || fields.CHANNEL.length > 128 || !stableId.test(fields.CHANNEL))
        diagnostics.push(diagnostic("BLK-EVENT-001", "事件通道标识无效", source));
      if (b.type === "core.event.receive" && (typeof fields.TIMEOUT_MS !== "string" || !/^\d+$/.test(fields.TIMEOUT_MS) || Number(fields.TIMEOUT_MS) > 30000))
        diagnostics.push(diagnostic("BLK-EVENT-001", "事件等待须在 0–30000 毫秒内", source));
    }
    if (b.type === 'core.run.budget') for (const [field,max] of [['STEPS',2000],['CALLS',16],['OUTPUT_TOKENS',4096],['TIMEOUT_MS',120000]] as const) {
      const value=fields[field]; if (typeof value!=='string' || !/^\d+$/.test(value) || Number(value)<1 || Number(value)>max) diagnostics.push(diagnostic('BLK-RUN-006','运行预算必须在支持范围内',source));
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
          (def.jsonFields?.includes(field) ? fields[field] === undefined : typeof fields[field] !== "string" || !fields[field])
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
      inputs[name] = child ? compile(child, isRpaSession(b.type) && name === "STEPS",b.type==="runtime.task.durable"&&name==="STEPS",workflowActive||b.type==="runtime.task.durable",b.type==="core.interaction.chat_entry"&&name==="HANDLER") : null;
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
    const next = b.next ? compile(b.next.block, rpaScope,workflowScope,workflowActive,b.type==="core.interaction.chat") : null;
    const node: IrNode = {
      nodeId: b.id,
      blockType: b.type,
      fields,
      inputs,
      ...(next ? { next } : {}),
    };
    if (b.type === "core.flow.parallel") {
      try { validateParallelNode(node); }
      catch (error) { diagnostics.push(diagnostic(error instanceof Error ? error.message : "BLK-FLOW-001", "并行分支仅支持结果、条件、等待和受限嵌套；不能执行共享状态或外部副作用", source)); }
    }
    if(b.type==="runtime.task.durable"){
      try{workflowLayout(node);}catch{diagnostics.push(diagnostic("BLK-WORKFLOW-SCOPE","工作流须包含声明的执行步骤、审批或检查点；后续操作请放入步骤内",source));}
    }
    if (isRpaSession(b.type)) {
      try { compileRpaSession(node, projectId); }
      catch (error) { diagnostics.push(diagnostic(error instanceof Error && /^BLK-RPA-/.test(error.message) ? error.message : "BLK-RPA-PLAN-001", "请检查自动化目标、定位器、步骤和输入来源", source)); }
    }
    return node;
  };
  const roots = workspace.blocks.blocks
    .map(block => compile(block))
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
