import {
  diagnostic,
  stableId,
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
export function compileWorkspace(
  projectId: string,
  module: ModuleDescriptor,
  workspace: Workspace,
): { ir: ModuleIR; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [],
    sourceMap: Record<string, SourceRef> = {},
    ids = new Set<string>();
  const compile = (b: WorkspaceBlock): IrNode | null => {
    if (b.disabled) return b.next ? compile(b.next.block) : null;
    const source = { projectId, moduleId: module.moduleId, blockId: b.id };
    if (ids.has(b.id))
      diagnostics.push(diagnostic("BLK-TYPE-002", "积木 ID 重复", source));
    ids.add(b.id);
    sourceMap[b.id] = source;
    const def = getBlock(b.type),
      fields = b.fields ?? {};
    if (!def)
      diagnostics.push(diagnostic("BLK-TYPE-004", "未注册积木", source));
    else
      for (const field of def.fields)
        if (typeof fields[field] !== "string" || !fields[field])
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
      inputs[name] = child ? compile(child) : null;
    }
    const next = b.next ? compile(b.next.block) : null;
    return {
      nodeId: b.id,
      blockType: b.type,
      fields,
      inputs,
      ...(next ? { next } : {}),
    };
  };
  const roots = workspace.blocks.blocks
    .map(compile)
    .filter((n): n is IrNode => n !== null);
  return {
    ir: {
      schemaVersion: "blocky.module-ir/v1alpha1",
      projectId,
      moduleId: module.moduleId,
      roots,
      exports: module.exports,
      sourceMap,
    },
    diagnostics,
  };
}
