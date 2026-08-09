import type { BlocklyOptions } from "blockly/core";
import type { SpikeBlockId } from "./catalog";

function category(
  name: string,
  colour: string,
  blockIds: readonly SpikeBlockId[],
) {
  return {
    kind: "category" as const,
    name,
    colour,
    contents: blockIds.map((type) => ({ kind: "block" as const, type })),
  };
}

export const LOCAL_TOOLBOX: NonNullable<BlocklyOptions["toolbox"]> = {
  kind: "categoryToolbox",
  contents: [
    category("AI 伙伴", "#5c6bc0", [
      "core.agent.define",
      "core.agent.add_tool",
    ]),
    category("交互入口", "#26a69a", [
      "core.interaction.chat_entry",
      "core.interaction.accept_text",
      "core.interaction.accept_image",
      "core.interaction.accept_file",
      "core.interaction.accept_voice",
      "core.interaction.expose_skill",
      "core.interaction.expose_plugin",
      "core.interaction.current_entry",
      "core.interaction.reference",
    ]),
    category("消息", "#42a5f5", [
      "core.message.incoming",
      "core.message.field",
      "core.message.create",
      "core.message.add_part",
      "core.message.reply",
      "core.message.send",
      "core.message.stream",
      "core.message.wait",
    ]),
    category("工具", "#ef6c00", [
      "core.tool.define",
      "core.tool.parameter",
      "core.tool.result_schema",
      "core.tool.reference",
      "core.tool.call",
      "core.tool.result",
      "core.tool.require_approval",
    ]),
    category("数据", "#78909c", [
      "core.data.literal",
      "core.data.record",
      "core.data.compare",
    ]),
    category("流程", "#8d6e63", [
      "core.event.manual_run",
      "core.flow.if",
    ]),
  ],
};
