import { getSpikeBlockCategory } from "../blockly/toolbox";
import type { BlockyProgram, IrNode } from "../core/ir";
import type { RuntimeEvent } from "../core/runtimeEvents";

export type ProgramBlockTypes = Readonly<Record<string, string>>;

export interface RuntimeEventPresentation {
  readonly categoryId:
    | "agents"
    | "interactions"
    | "messages"
    | "tools"
    | "reason"
    | "knowledge"
    | "model"
    | "guardrails"
    | "output"
    | "data"
    | "flow"
    | "neutral";
  readonly categoryName: string;
  readonly colour: `#${string}`;
}

const NEUTRAL_PRESENTATION: RuntimeEventPresentation = Object.freeze({
  categoryId: "neutral",
  categoryName: "系统",
  colour: "#8f99a8",
});

export function indexProgramBlockTypes(program: BlockyProgram): ProgramBlockTypes {
  const blockTypes: Record<string, string> = {};
  const visited = new Set<string>();

  const visit = (node: IrNode | null): void => {
    if (!node || visited.has(node.id)) return;
    visited.add(node.id);
    blockTypes[node.id] = node.type;
    for (const input of Object.values(node.inputs)) visit(input);
    visit(node.next);
  };

  for (const root of program.roots) visit(root);
  return Object.freeze(blockTypes);
}

export function presentRuntimeEvent(
  event: RuntimeEvent,
  blockTypes: ProgramBlockTypes,
): RuntimeEventPresentation {
  const blockType = event.blockId ? blockTypes[event.blockId] : undefined;
  const category = blockType ? getSpikeBlockCategory(blockType) : undefined;
  if (!category) return NEUTRAL_PRESENTATION;
  return Object.freeze({
    categoryId: category.id,
    categoryName: category.name,
    colour: category.colour,
  });
}
