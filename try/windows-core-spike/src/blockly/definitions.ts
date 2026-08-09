import * as Blockly from "blockly/core";
import type { JsonBlockDefinition } from "blockly/core";
import { SPIKE_BLOCK_IDS, type SpikeBlockId } from "./catalog";
import {
  BOOLEAN_OUTPUT_SHAPE,
  CONNECTION_CHECK,
  commandConnections,
  type ConnectionGrammar,
} from "./connectionGrammar";

type VisualRole =
  | "agent"
  | "interaction"
  | "tool"
  | "message"
  | "event"
  | "data"
  | "flow";

type StatementInput = Readonly<{ name: string; check: string }>;

export type SpikeBlockDefinition = Readonly<{
  id: SpikeBlockId;
  grammar: ConnectionGrammar;
  visualRole: VisualRole;
  hasInlineComposer: boolean;
  outputCheck?: string;
  statementInputs?: readonly StatementInput[];
  json: JsonBlockDefinition;
}>;

const roleColours: Record<VisualRole, string> = {
  agent: "#5C6BC0",
  interaction: "#26A69A",
  tool: "#EF6C00",
  message: "#42A5F5",
  event: "#AB47BC",
  data: "#78909C",
  flow: "#8D6E63",
};

function block(
  id: SpikeBlockId,
  grammar: ConnectionGrammar,
  visualRole: VisualRole,
  json: Omit<JsonBlockDefinition, "type" | "colour">,
  options: Pick<SpikeBlockDefinition, "outputCheck" | "statementInputs"> = {},
): SpikeBlockDefinition {
  return {
    id,
    grammar,
    visualRole,
    hasInlineComposer: false,
    ...options,
    json: { type: id, colour: roleColours[visualRole], ...json },
  };
}

const agentMemberConnections = Object.freeze({
  previousStatement: CONNECTION_CHECK.agentMember,
  nextStatement: CONNECTION_CHECK.agentMember,
});

const entryCapabilityConnections = Object.freeze({
  previousStatement: CONNECTION_CHECK.entryCapability,
  nextStatement: CONNECTION_CHECK.entryCapability,
});

const toolContractConnections = Object.freeze({
  previousStatement: CONNECTION_CHECK.toolContract,
  nextStatement: CONNECTION_CHECK.toolContract,
});

const definitions = [
  block("core.agent.define", "statement-container", "agent", {
    message0: "智能体 %1 成员 %2",
    args0: [
      { type: "field_input", name: "NAME", text: "智能体" },
      { type: "input_statement", name: "MEMBERS", check: CONNECTION_CHECK.agentMember },
    ],
  }, { statementInputs: [{ name: "MEMBERS", check: CONNECTION_CHECK.agentMember }] }),
  block("core.agent.add_tool", "statement-container", "agent", {
    message0: "添加工具 %1",
    args0: [{ type: "input_value", name: "TOOL", check: CONNECTION_CHECK.toolRef }],
    ...agentMemberConnections,
  }),
  block("core.interaction.chat_entry", "statement-container", "interaction", {
    message0: "聊天入口 %1 能力 %2 处理器 %3",
    args0: [
      { type: "field_input", name: "NAME", text: "聊天" },
      { type: "input_statement", name: "CAPABILITIES", check: CONNECTION_CHECK.entryCapability },
      { type: "input_statement", name: "HANDLER", check: CONNECTION_CHECK.command },
    ],
    ...agentMemberConnections,
  }, {
    statementInputs: [
      { name: "CAPABILITIES", check: CONNECTION_CHECK.entryCapability },
      { name: "HANDLER", check: CONNECTION_CHECK.command },
    ],
  }),
  block("core.interaction.accept_text", "statement-container", "interaction", {
    message0: "接收文本",
    ...entryCapabilityConnections,
  }),
  block("core.interaction.accept_image", "statement-container", "interaction", {
    message0: "接收图片",
    ...entryCapabilityConnections,
  }),
  block("core.interaction.accept_file", "statement-container", "interaction", {
    message0: "接收文件",
    ...entryCapabilityConnections,
  }),
  block("core.interaction.accept_voice", "statement-container", "interaction", {
    message0: "接收语音",
    ...entryCapabilityConnections,
  }),
  block("core.interaction.expose_skill", "statement-container", "interaction", {
    message0: "暴露技能 %1",
    args0: [{ type: "field_input", name: "SKILL", text: "技能" }],
    ...entryCapabilityConnections,
  }),
  block("core.interaction.expose_plugin", "statement-container", "interaction", {
    message0: "暴露插件 %1",
    args0: [{ type: "field_input", name: "PLUGIN", text: "插件" }],
    ...entryCapabilityConnections,
  }),
  block("core.interaction.current_entry", "reference", "interaction", {
    message0: "当前入口",
    output: CONNECTION_CHECK.entryRef,
  }, { outputCheck: CONNECTION_CHECK.entryRef }),
  block("core.interaction.reference", "reference", "interaction", {
    message0: "入口引用 %1",
    args0: [{ type: "field_input", name: "ENTRY_ID", text: "聊天" }],
    output: CONNECTION_CHECK.entryRef,
  }, { outputCheck: CONNECTION_CHECK.entryRef }),
  block("core.event.manual_run", "event-hat", "event", {
    message0: "手动运行时",
    nextStatement: CONNECTION_CHECK.command,
  }),
  block("core.message.incoming", "event-hat", "event", {
    message0: "收到消息时",
    nextStatement: CONNECTION_CHECK.command,
  }),
  block("core.message.field", "typed-value", "message", {
    message0: "消息字段 %1 来自 %2",
    args0: [
      { type: "field_input", name: "FIELD", text: "文本" },
      { type: "input_value", name: "MESSAGE", check: CONNECTION_CHECK.message },
    ],
    output: CONNECTION_CHECK.json,
  }, { outputCheck: CONNECTION_CHECK.json }),
  block("core.message.create", "typed-value", "message", {
    message0: "创建消息 %1",
    args0: [{ type: "input_value", name: "CONTENT", check: CONNECTION_CHECK.json }],
    output: CONNECTION_CHECK.message,
  }, { outputCheck: CONNECTION_CHECK.message }),
  block("core.message.add_part", "command", "message", {
    message0: "添加片段 %1",
    args0: [{ type: "input_value", name: "PART", check: CONNECTION_CHECK.json }],
    ...commandConnections,
  }),
  block("core.message.reply", "command", "message", {
    message0: "回复 %1",
    args0: [{ type: "input_value", name: "MESSAGE", check: CONNECTION_CHECK.message }],
    ...commandConnections,
  }),
  block("core.message.send", "command", "message", {
    message0: "发送消息",
    ...commandConnections,
  }),
  block("core.message.stream", "command", "message", {
    message0: "流式发送消息",
    ...commandConnections,
  }),
  block("core.message.wait", "command", "message", {
    message0: "等待",
    ...commandConnections,
  }),
  block("core.tool.define", "statement-container", "tool", {
    message0: "工具 %1 合同 %2",
    args0: [
      { type: "field_input", name: "TOOL_ID", text: "tool.weather" },
      { type: "input_statement", name: "CONTRACT", check: CONNECTION_CHECK.toolContract },
    ],
  }, { statementInputs: [{ name: "CONTRACT", check: CONNECTION_CHECK.toolContract }] }),
  block("core.tool.parameter", "statement-container", "tool", {
    message0: "参数 %1",
    args0: [{ type: "field_input", name: "NAME", text: "城市" }],
    ...toolContractConnections,
  }),
  block("core.tool.result_schema", "statement-container", "tool", {
    message0: "结果架构",
    ...toolContractConnections,
  }),
  block("core.tool.reference", "reference", "tool", {
    message0: "工具引用 %1",
    args0: [{ type: "field_input", name: "TOOL_ID", text: "tool.weather" }],
    output: CONNECTION_CHECK.toolRef,
  }, { outputCheck: CONNECTION_CHECK.toolRef }),
  block("core.tool.call", "typed-value", "tool", {
    message0: "调用工具 %1",
    args0: [{ type: "input_value", name: "TOOL", check: CONNECTION_CHECK.toolRef }],
    output: CONNECTION_CHECK.json,
  }, { outputCheck: CONNECTION_CHECK.json }),
  block("core.tool.result", "typed-value", "tool", {
    message0: "工具结果",
    output: CONNECTION_CHECK.json,
  }, { outputCheck: CONNECTION_CHECK.json }),
  block("core.tool.require_approval", "statement-container", "tool", {
    message0: "需要审批",
    ...toolContractConnections,
  }),
  block("core.data.literal", "typed-value", "data", {
    message0: "字面量 %1",
    args0: [{ type: "field_input", name: "VALUE", text: "值" }],
    output: CONNECTION_CHECK.json,
  }, { outputCheck: CONNECTION_CHECK.json }),
  block("core.data.record", "typed-value", "data", {
    message0: "记录值 %1",
    args0: [{ type: "input_value", name: "VALUE", check: CONNECTION_CHECK.json }],
    output: CONNECTION_CHECK.json,
  }, { outputCheck: CONNECTION_CHECK.json }),
  block("core.data.compare", "boolean-condition", "data", {
    message0: "比较 %1 等于 %2",
    args0: [
      { type: "input_value", name: "LEFT", check: CONNECTION_CHECK.json },
      { type: "input_value", name: "RIGHT", check: CONNECTION_CHECK.json },
    ],
    output: CONNECTION_CHECK.boolean,
    outputShape: BOOLEAN_OUTPUT_SHAPE,
  }, { outputCheck: CONNECTION_CHECK.boolean }),
  block("core.flow.if", "statement-container", "flow", {
    message0: "如果 %1 则执行 %2",
    args0: [
      { type: "input_value", name: "CONDITION", check: CONNECTION_CHECK.boolean },
      { type: "input_statement", name: "DO", check: CONNECTION_CHECK.command },
    ],
    ...commandConnections,
  }, { statementInputs: [{ name: "DO", check: CONNECTION_CHECK.command }] }),
] as const satisfies readonly SpikeBlockDefinition[];

const definitionById = new Map<SpikeBlockId, SpikeBlockDefinition>(
  definitions.map((definition) => [definition.id, definition]),
);

export function getDefinition(id: SpikeBlockId): SpikeBlockDefinition {
  const definition = definitionById.get(id);
  if (!definition) throw new Error(`Unknown spike block definition: ${id}`);
  return definition;
}

export function registerSpikeBlocks(): void {
  const unregistered = SPIKE_BLOCK_IDS.filter((id) => !Blockly.Blocks[id]);
  Blockly.defineBlocksWithJsonArray(
    unregistered.map((id) => getDefinition(id).json),
  );
}
