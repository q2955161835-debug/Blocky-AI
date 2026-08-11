import type { BlocklyOptions } from "blockly/core";
import type { SpikeBlockId } from "./catalog";

export type SpikeBlockCategoryId =
  | "agents"
  | "interactions"
  | "messages"
  | "tools"
  | "data"
  | "flow";

export interface SpikeBlockCategory {
  readonly id: SpikeBlockCategoryId;
  readonly name: string;
  readonly colour: `#${string}`;
  readonly blockIds: readonly SpikeBlockId[];
}

export const SPIKE_BLOCK_CATEGORIES = Object.freeze([
  {
    id: "agents",
    name: "AI 伙伴",
    colour: "#5c6bc0",
    blockIds: ["core.agent.define", "core.agent.add_tool"],
  },
  {
    id: "interactions",
    name: "交互入口",
    colour: "#26a69a",
    blockIds: [
      "core.interaction.chat_entry",
      "core.interaction.accept_text",
      "core.interaction.accept_image",
      "core.interaction.accept_file",
      "core.interaction.accept_voice",
      "core.interaction.expose_skill",
      "core.interaction.expose_plugin",
      "core.interaction.current_entry",
      "core.interaction.reference",
    ],
  },
  {
    id: "messages",
    name: "消息",
    colour: "#42a5f5",
    blockIds: [
      "core.message.incoming",
      "core.message.field",
      "core.message.create",
      "core.message.add_part",
      "core.message.reply",
      "core.message.send",
      "core.message.stream",
      "core.message.wait",
    ],
  },
  {
    id: "tools",
    name: "工具",
    colour: "#ef6c00",
    blockIds: [
      "core.tool.define",
      "core.tool.parameter",
      "core.tool.result_schema",
      "core.tool.reference",
      "core.tool.call",
      "core.tool.result",
      "core.tool.require_approval",
    ],
  },
  {
    id: "data",
    name: "数据",
    colour: "#78909c",
    blockIds: [
      "core.data.literal",
      "core.data.record",
      "core.data.compare",
    ],
  },
  {
    id: "flow",
    name: "流程",
    colour: "#8d6e63",
    blockIds: ["core.event.manual_run", "core.flow.if"],
  },
] as const satisfies readonly SpikeBlockCategory[]);

export function getSpikeBlockCategory(
  blockType: string,
): SpikeBlockCategory | undefined {
  return SPIKE_BLOCK_CATEGORIES.find((category) =>
    category.blockIds.some((candidate) => candidate === blockType),
  );
}

export function getSpikeBlockColour(blockType: string): string | undefined {
  return getSpikeBlockCategory(blockType)?.colour;
}

export const LOCAL_TOOLBOX: NonNullable<BlocklyOptions["toolbox"]> = {
  kind: "categoryToolbox",
  contents: SPIKE_BLOCK_CATEGORIES.map((category) => ({
    kind: "category" as const,
    name: category.name,
    colour: category.colour,
    contents: category.blockIds.map((type) => ({
      kind: "block" as const,
      type,
    })),
  })),
};
