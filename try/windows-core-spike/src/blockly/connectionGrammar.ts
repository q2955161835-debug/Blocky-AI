export const CONNECTION_GRAMMARS = [
  "event-hat",
  "command",
  "typed-value",
  "boolean-condition",
  "statement-container",
  "reference",
] as const;

export const CONNECTION_CHECK = Object.freeze({
  command: "slot.command",
  agentMember: "slot.agent_member",
  entryCapability: "slot.entry_capability",
  toolContract: "slot.tool_contract",
  boolean: "type.boolean",
  agentRef: "type.agent_ref",
  entryRef: "type.interaction_entry_ref",
  toolRef: "type.tool_ref",
  message: "type.message",
  json: "type.json",
} as const);

export const commandConnections = Object.freeze({
  previousStatement: CONNECTION_CHECK.command,
  nextStatement: CONNECTION_CHECK.command,
});

/** Blockly's JSON renderer enum value for a hexagonal output connector. */
export const BOOLEAN_OUTPUT_SHAPE = 1;

export type ConnectionGrammar = (typeof CONNECTION_GRAMMARS)[number];
