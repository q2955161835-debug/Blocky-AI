import type { Diagnostic } from "./diagnostics";
import type { BlockyProgram, IrNode } from "./ir";

export type InputPartKind = "text" | "image" | "file" | "voice";

export interface InteractionEntry {
  readonly id: string;
  readonly ownerAgentId: string;
  readonly displayName: string;
  readonly acceptedParts: readonly InputPartKind[];
  readonly exposedSkills: readonly string[];
  readonly exposedPluginActions: readonly string[];
  readonly executionRequirements: readonly string[];
}

export interface InteractionManifest {
  readonly schemaVersion: "blocky.interaction/v0-spike";
  readonly entries: readonly InteractionEntry[];
}

export interface InteractionCompileResult {
  readonly manifest: InteractionManifest;
  readonly diagnostics: readonly Diagnostic[];
}

const PARTS: readonly Readonly<{ type: string; part: InputPartKind }> [] = Object.freeze([
  Object.freeze({ type: "core.interaction.accept_text", part: "text" }),
  Object.freeze({ type: "core.interaction.accept_image", part: "image" }),
  Object.freeze({ type: "core.interaction.accept_file", part: "file" }),
  Object.freeze({ type: "core.interaction.accept_voice", part: "voice" }),
]);

function stringField(node: IrNode, fieldName: string): string | undefined {
  const value = node.fields?.[fieldName];
  return typeof value === "string" ? value : undefined;
}

function nonBlankField(node: IrNode, fieldName: string): string | undefined {
  const value = stringField(node, fieldName);
  return value && value.trim().length > 0 ? value : undefined;
}

function memberChain(first: IrNode | undefined): IrNode[] {
  const nodes: IrNode[] = [];
  const visited = new Set<IrNode>();
  let current = first;
  while (current && !visited.has(current)) {
    visited.add(current);
    nodes.push(current);
    current = current.next;
  }
  return nodes;
}

function capabilityChain(first: IrNode | undefined): IrNode[] {
  return memberChain(first);
}

function allNodes(program: BlockyProgram): IrNode[] {
  const nodes: IrNode[] = [];
  const visited = new Set<IrNode>();
  const visit = (current: IrNode | undefined): void => {
    if (!current || visited.has(current)) return;
    visited.add(current);
    nodes.push(current);
    for (const input of Object.values(current.inputs ?? {})) visit(input);
    visit(current.next);
  };
  for (const root of program.roots) visit(root);
  return nodes;
}

function capabilityIds(nodes: IrNode[], type: string, fieldName: string): readonly string[] {
  return Object.freeze([...new Set(nodes
    .filter((node) => node.type === type)
    .map((node) => nonBlankField(node, fieldName))
    .filter((value): value is string => value !== undefined))]
    .sort());
}

function compileEntry(entry: IrNode, ownerAgentId: string, ordinal: number): InteractionEntry {
  const capabilities = capabilityChain(entry.inputs?.CAPABILITIES);
  const acceptedParts = Object.freeze(PARTS
    .filter(({ type }) => capabilities.some((capability) => capability.type === type))
    .map(({ part }) => part));
  const displayName = nonBlankField(entry, "NAME") ?? `输入 ${ordinal}`;

  return Object.freeze({
    id: entry.id,
    ownerAgentId,
    displayName,
    acceptedParts,
    exposedSkills: capabilityIds(capabilities, "core.interaction.expose_skill", "SKILL"),
    exposedPluginActions: capabilityIds(capabilities, "core.interaction.expose_plugin", "PLUGIN"),
    executionRequirements: Object.freeze([]),
  });
}

function orphanDiagnostic(entry: IrNode): Diagnostic {
  return {
    code: "INTERACTION_ORPHAN_ENTRY",
    message: `聊天入口 ${entry.id} 必须位于智能体成员区内`,
    severity: "error",
    blockId: entry.id,
  };
}

function emptyHandlerDiagnostic(entry: IrNode): Diagnostic {
  return {
    code: "INTERACTION_EMPTY_HANDLER",
    message: `聊天入口 ${entry.id} 必须配置处理器`,
    severity: "error",
    blockId: entry.id,
  };
}

export function compileInteractionManifest(program: BlockyProgram): InteractionCompileResult {
  const diagnostics: Diagnostic[] = [];
  const validEntries = new Set<IrNode>();
  const entries: InteractionEntry[] = [];

  for (const agent of program.roots.filter((node) => node.type === "core.agent.define")) {
    let entryOrdinal = 0;
    for (const member of memberChain(agent.inputs?.MEMBERS)) {
      if (member.type !== "core.interaction.chat_entry") continue;
      entryOrdinal += 1;
      validEntries.add(member);
      if (!member.inputs?.HANDLER) {
        diagnostics.push(emptyHandlerDiagnostic(member));
        continue;
      }
      entries.push(compileEntry(member, agent.id, entryOrdinal));
    }
  }

  for (const node of allNodes(program)) {
    if (node.type === "core.interaction.chat_entry" && !validEntries.has(node)) {
      diagnostics.push(orphanDiagnostic(node));
    }
  }

  const firstEntryByName = new Map<string, InteractionEntry>();
  for (const entry of entries) {
    if (firstEntryByName.has(entry.displayName)) {
      diagnostics.push({
        code: "INTERACTION_DUPLICATE_DISPLAY_NAME",
        message: `聊天入口名称 ${entry.displayName} 重复，仍使用稳定入口 ID 路由`,
        severity: "warning",
        blockId: entry.id,
      });
      continue;
    }
    firstEntryByName.set(entry.displayName, entry);
  }

  return Object.freeze({
    manifest: Object.freeze({
      schemaVersion: "blocky.interaction/v0-spike",
      entries: Object.freeze(entries),
    }),
    diagnostics: Object.freeze(diagnostics),
  });
}
