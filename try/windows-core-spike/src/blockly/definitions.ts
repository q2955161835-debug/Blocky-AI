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
    message0: "agent %1 members %2",
    args0: [
      { type: "field_input", name: "NAME", text: "Agent" },
      { type: "input_statement", name: "MEMBERS", check: CONNECTION_CHECK.agentMember },
    ],
  }, { statementInputs: [{ name: "MEMBERS", check: CONNECTION_CHECK.agentMember }] }),
  block("core.agent.add_tool", "statement-container", "agent", {
    message0: "add tool %1",
    args0: [{ type: "input_value", name: "TOOL", check: CONNECTION_CHECK.toolRef }],
    ...agentMemberConnections,
  }),
  block("core.interaction.chat_entry", "statement-container", "interaction", {
    message0: "chat entry %1 capabilities %2 handler %3",
    args0: [
      { type: "field_input", name: "NAME", text: "Chat" },
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
    message0: "accept text",
    ...entryCapabilityConnections,
  }),
  block("core.interaction.accept_image", "statement-container", "interaction", {
    message0: "accept image",
    ...entryCapabilityConnections,
  }),
  block("core.interaction.accept_file", "statement-container", "interaction", {
    message0: "accept file",
    ...entryCapabilityConnections,
  }),
  block("core.interaction.accept_voice", "statement-container", "interaction", {
    message0: "accept voice",
    ...entryCapabilityConnections,
  }),
  block("core.interaction.expose_skill", "statement-container", "interaction", {
    message0: "expose skill %1",
    args0: [{ type: "field_input", name: "SKILL", text: "skill" }],
    ...entryCapabilityConnections,
  }),
  block("core.interaction.expose_plugin", "statement-container", "interaction", {
    message0: "expose plugin %1",
    args0: [{ type: "field_input", name: "PLUGIN", text: "plugin" }],
    ...entryCapabilityConnections,
  }),
  block("core.interaction.current_entry", "reference", "interaction", {
    message0: "current entry",
    output: CONNECTION_CHECK.entryRef,
  }, { outputCheck: CONNECTION_CHECK.entryRef }),
  block("core.interaction.reference", "reference", "interaction", {
    message0: "entry reference %1",
    args0: [{ type: "field_input", name: "ENTRY_ID", text: "chat" }],
    output: CONNECTION_CHECK.entryRef,
  }, { outputCheck: CONNECTION_CHECK.entryRef }),
  block("core.event.manual_run", "event-hat", "event", {
    message0: "when manually run",
    nextStatement: CONNECTION_CHECK.command,
  }),
  block("core.message.incoming", "event-hat", "event", {
    message0: "when message arrives",
    nextStatement: CONNECTION_CHECK.command,
  }),
  block("core.message.field", "typed-value", "message", {
    message0: "message field %1 of %2",
    args0: [
      { type: "field_input", name: "FIELD", text: "text" },
      { type: "input_value", name: "MESSAGE", check: CONNECTION_CHECK.message },
    ],
    output: CONNECTION_CHECK.json,
  }, { outputCheck: CONNECTION_CHECK.json }),
  block("core.message.create", "typed-value", "message", {
    message0: "create message %1",
    args0: [{ type: "input_value", name: "CONTENT", check: CONNECTION_CHECK.json }],
    output: CONNECTION_CHECK.message,
  }, { outputCheck: CONNECTION_CHECK.message }),
  block("core.message.add_part", "command", "message", {
    message0: "add part %1",
    args0: [{ type: "input_value", name: "PART", check: CONNECTION_CHECK.json }],
    ...commandConnections,
  }),
  block("core.message.reply", "command", "message", {
    message0: "reply %1",
    args0: [{ type: "input_value", name: "MESSAGE", check: CONNECTION_CHECK.message }],
    ...commandConnections,
  }),
  block("core.message.send", "command", "message", {
    message0: "send message",
    ...commandConnections,
  }),
  block("core.message.stream", "command", "message", {
    message0: "stream message",
    ...commandConnections,
  }),
  block("core.message.wait", "command", "message", {
    message0: "wait",
    ...commandConnections,
  }),
  block("core.tool.define", "statement-container", "tool", {
    message0: "tool %1 contract %2",
    args0: [
      { type: "field_input", name: "TOOL_ID", text: "tool.weather" },
      { type: "input_statement", name: "CONTRACT", check: CONNECTION_CHECK.toolContract },
    ],
  }, { statementInputs: [{ name: "CONTRACT", check: CONNECTION_CHECK.toolContract }] }),
  block("core.tool.parameter", "statement-container", "tool", {
    message0: "parameter %1",
    args0: [{ type: "field_input", name: "NAME", text: "city" }],
    ...toolContractConnections,
  }),
  block("core.tool.result_schema", "statement-container", "tool", {
    message0: "result schema",
    ...toolContractConnections,
  }),
  block("core.tool.reference", "reference", "tool", {
    message0: "tool reference %1",
    args0: [{ type: "field_input", name: "TOOL_ID", text: "tool.weather" }],
    output: CONNECTION_CHECK.toolRef,
  }, { outputCheck: CONNECTION_CHECK.toolRef }),
  block("core.tool.call", "typed-value", "tool", {
    message0: "call tool %1",
    args0: [{ type: "input_value", name: "TOOL", check: CONNECTION_CHECK.toolRef }],
    output: CONNECTION_CHECK.json,
  }, { outputCheck: CONNECTION_CHECK.json }),
  block("core.tool.result", "typed-value", "tool", {
    message0: "tool result",
    output: CONNECTION_CHECK.json,
  }, { outputCheck: CONNECTION_CHECK.json }),
  block("core.tool.require_approval", "statement-container", "tool", {
    message0: "require approval",
    ...toolContractConnections,
  }),
  block("core.data.literal", "typed-value", "data", {
    message0: "literal %1",
    args0: [{ type: "field_input", name: "VALUE", text: "value" }],
    output: CONNECTION_CHECK.json,
  }, { outputCheck: CONNECTION_CHECK.json }),
  block("core.data.record", "typed-value", "data", {
    message0: "record value %1",
    args0: [{ type: "input_value", name: "VALUE", check: CONNECTION_CHECK.json }],
    output: CONNECTION_CHECK.json,
  }, { outputCheck: CONNECTION_CHECK.json }),
  block("core.data.compare", "boolean-condition", "data", {
    message0: "compare %1 equals %2",
    args0: [
      { type: "input_value", name: "LEFT", check: CONNECTION_CHECK.json },
      { type: "input_value", name: "RIGHT", check: CONNECTION_CHECK.json },
    ],
    output: CONNECTION_CHECK.boolean,
    outputShape: BOOLEAN_OUTPUT_SHAPE,
  }, { outputCheck: CONNECTION_CHECK.boolean }),
  block("core.flow.if", "statement-container", "flow", {
    message0: "if %1 do %2",
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
