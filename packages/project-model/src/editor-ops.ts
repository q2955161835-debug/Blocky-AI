import { parseExpressionProgram, stableId, type Project, type Workspace, type WorkspaceBlock } from "@blocky/language-schema";
import { z } from "zod";

type Alignment = "left" | "center" | "right" | "top" | "middle" | "bottom";
export type SelectionEdit =
  | { kind: "align"; axis: Alignment }
  | { kind: "distribute"; axis: "horizontal" | "vertical" }
  | { kind: "enable"; value: boolean }
  | { kind: "group"; groupId: string; label: string; region?: boolean }
  | { kind: "ungroup" }
  | { kind: "annotate"; note: string };
export const selectionEditSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("align"), axis: z.enum(["left", "center", "right", "top", "middle", "bottom"]) }).strict(),
  z.object({ kind: z.literal("distribute"), axis: z.enum(["horizontal", "vertical"]) }).strict(),
  z.object({ kind: z.literal("enable"), value: z.boolean() }).strict(),
  z.object({ kind: z.literal("group"), groupId: z.string(), label: z.string(), region: z.boolean().optional() }).strict(),
  z.object({ kind: z.literal("ungroup") }).strict(),
  z.object({ kind: z.literal("annotate"), note: z.string() }).strict(),
]);
export const editorOperationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("edit"), moduleId: z.string(), ids: z.array(z.string()).min(1).max(100), edit: selectionEditSchema }).strict(),
  z.object({ kind: z.literal("copy"), sourceModuleId: z.string(), targetModuleId: z.string(), ids: z.array(z.string()).min(1).max(100) }).strict(),
]);

type EditorData = {
  schemaVersion: "blocky.editor/v1";
  group?: { id: string; label: string; kind: "group" | "region" };
  note?: string;
  codeEdited?: boolean;
};

function metadata(block: WorkspaceBlock): EditorData {
  if (!block.data) return { schemaVersion: "blocky.editor/v1" };
  let value: unknown;
  try { value = JSON.parse(block.data); }
  catch { throw Error("BLK-EDIT-004"); }
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      (value as Record<string, unknown>).schemaVersion !== "blocky.editor/v1")
    throw Error("BLK-EDIT-004");
  return value as EditorData;
}

export type CodeState = "official-default" | "custom-valid" | "warning" | "invalid";
export function codeState(block: WorkspaceBlock): CodeState {
  if (block.type !== "core.data.transform") throw Error("BLK-EDIT-005");
  try { parseExpressionProgram(block.fields?.PROGRAM); }
  catch { return "invalid"; }
  if (block.fields?.SOURCE != null) return "warning";
  try {
    const value = metadata(block).codeEdited;
    if (value !== undefined && typeof value !== "boolean") return "warning";
    return value ? "custom-valid" : "official-default";
  }
  catch { return "warning"; }
}

export function markCodeEdited(block: WorkspaceBlock): void {
  const data = metadata(block);
  data.codeEdited = true;
  block.data = JSON.stringify(data);
}

function roots(workspace: Workspace, ids: string[]): WorkspaceBlock[] {
  if (!ids.length || new Set(ids).size !== ids.length) throw Error("BLK-EDIT-001");
  const selected = ids.map((id) => workspace.blocks.blocks.find((block) => block.id === id));
  if (selected.some((block) => !block)) throw Error("BLK-EDIT-001");
  return selected as WorkspaceBlock[];
}

export function editSelection(workspace: Workspace, ids: string[], edit: SelectionEdit): void {
  const blocks = roots(workspace, ids);
  if (edit.kind === "align") {
    if (blocks.length < 2) throw Error("BLK-EDIT-001");
    const horizontal = ["left", "center", "right"].includes(edit.axis);
    const key = horizontal ? "x" : "y";
    const values = blocks.map((block) => block[key] ?? 0);
    const target = edit.axis === "left" || edit.axis === "top"
      ? Math.min(...values)
      : edit.axis === "right" || edit.axis === "bottom"
        ? Math.max(...values)
        : values.reduce((sum, value) => sum + value, 0) / values.length;
    for (const block of blocks) block[key] = target;
  } else if (edit.kind === "distribute") {
    if (blocks.length < 3) throw Error("BLK-EDIT-001");
    const key = edit.axis === "horizontal" ? "x" : "y";
    const sorted = [...blocks].sort((a, b) => (a[key] ?? 0) - (b[key] ?? 0));
    const first = sorted[0][key] ?? 0;
    const last = sorted.at(-1)![key] ?? 0;
    sorted.forEach((block, index) => { block[key] = first + (last - first) * index / (sorted.length - 1); });
  } else if (edit.kind === "enable") {
    for (const block of blocks) block.disabled = !edit.value;
  } else {
    if (edit.kind === "group" && (!stableId.test(edit.groupId) || !edit.label.trim() || edit.label.length > 80))
      throw Error("BLK-EDIT-002");
    if (edit.kind === "annotate" && edit.note.length > 2000) throw Error("BLK-EDIT-002");
    const values = blocks.map(metadata);
    blocks.forEach((block, index) => {
      const value = values[index];
      if (edit.kind === "group") value.group = {
        id: edit.groupId,
        label: edit.label.trim(),
        kind: edit.region ? "region" : "group",
      };
      if (edit.kind === "ungroup") delete value.group;
      if (edit.kind === "annotate") value.note = edit.note;
      block.data = JSON.stringify(value);
    });
  }
}

/** Copies selected top-level stacks as one project edit; callers own the controller transaction. */
export function copyAcrossModules(
  project: Project,
  sourceModuleId: string,
  targetModuleId: string,
  ids: string[],
  newId: () => string,
): string[] {
  const source = project.workspaces[sourceModuleId];
  const target = project.workspaces[targetModuleId];
  if (!source || !target) throw Error("BLK-EDIT-001");
  const selected = roots(source, ids);
  const copied = structuredClone(selected);
  const used = new Set<string>();
  for (const block of target.blocks.blocks) visit(block, (item) => { used.add(item.id); });
  for (const block of copied) visit(block, (item) => {
    const id = newId();
    if (!stableId.test(id) || used.has(id)) throw Error("BLK-EDIT-003");
    used.add(id);
    item.id = id;
    if (typeof item.x === "number") item.x += 40;
    if (typeof item.y === "number") item.y += 40;
  });
  target.blocks.blocks.push(...copied);
  return copied.map((block) => block.id);
}

function visit(block: WorkspaceBlock, apply: (block: WorkspaceBlock) => void): void {
  apply(block);
  for (const input of Object.values(block.inputs ?? {})) {
    if (input.block) visit(input.block, apply);
    if (input.shadow) visit(input.shadow, apply);
  }
  if (block.next) visit(block.next.block, apply);
}
