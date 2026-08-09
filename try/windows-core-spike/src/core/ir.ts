import type { JsonValue } from "./json";

export type ConnectionShape =
  | "slot.agent_member"
  | "slot.command"
  | "slot.entry_capability"
  | "slot.tool_contract"
  | "type.boolean"
  | "type.interaction_entry_ref"
  | "type.json"
  | "type.message"
  | "type.tool_ref";

export interface IrNode {
  id: string;
  type: string;
  fields?: Record<string, JsonValue>;
  inputs?: Record<string, IrNode>;
  next?: IrNode;
}

export interface BlockyProgram {
  schemaVersion: "blocky.ir/v0-spike";
  roots: IrNode[];
}

export interface BlockSpec {
  output?: ConnectionShape;
  previous?: ConnectionShape;
  next?: ConnectionShape;
  inputs?: Record<string, ConnectionShape>;
}

const command = "slot.command" as const;
const agentMember = "slot.agent_member" as const;
const entryCapability = "slot.entry_capability" as const;
const toolContract = "slot.tool_contract" as const;
const json = "type.json" as const;

/** Pure semantic metadata mirrored from the deliberately fixed spike catalog. */
export const SPIKE_BLOCK_SPECS: Readonly<Record<string, BlockSpec>> = Object.freeze({
  "core.agent.define": { inputs: { MEMBERS: agentMember } },
  "core.agent.add_tool": { previous: agentMember, next: agentMember, inputs: { TOOL: "type.tool_ref" } },
  "core.interaction.chat_entry": { previous: agentMember, next: agentMember, inputs: { CAPABILITIES: entryCapability, HANDLER: command } },
  "core.interaction.accept_text": { previous: entryCapability, next: entryCapability },
  "core.interaction.accept_image": { previous: entryCapability, next: entryCapability },
  "core.interaction.accept_file": { previous: entryCapability, next: entryCapability },
  "core.interaction.accept_voice": { previous: entryCapability, next: entryCapability },
  "core.interaction.expose_skill": { previous: entryCapability, next: entryCapability },
  "core.interaction.expose_plugin": { previous: entryCapability, next: entryCapability },
  "core.interaction.current_entry": { output: "type.interaction_entry_ref" },
  "core.interaction.reference": { output: "type.interaction_entry_ref" },
  "core.event.manual_run": { next: command },
  "core.message.incoming": { next: command },
  "core.message.field": { output: json, inputs: { MESSAGE: "type.message" } },
  "core.message.create": { output: "type.message", inputs: { CONTENT: json } },
  "core.message.add_part": { previous: command, next: command, inputs: { PART: json } },
  "core.message.reply": { previous: command, next: command, inputs: { MESSAGE: "type.message" } },
  "core.message.send": { previous: command, next: command },
  "core.message.stream": { previous: command, next: command },
  "core.message.wait": { previous: command, next: command },
  "core.tool.define": { inputs: { CONTRACT: toolContract } },
  "core.tool.parameter": { previous: toolContract, next: toolContract },
  "core.tool.result_schema": { previous: toolContract, next: toolContract },
  "core.tool.reference": { output: "type.tool_ref" },
  "core.tool.call": { output: json, inputs: { TOOL: "type.tool_ref" } },
  "core.tool.result": { output: json },
  "core.tool.require_approval": { previous: toolContract, next: toolContract },
  "core.data.literal": { output: json },
  "core.data.record": { output: json, inputs: { VALUE: json } },
  "core.data.compare": { output: "type.boolean", inputs: { LEFT: json, RIGHT: json } },
  "core.flow.if": { previous: command, next: command, inputs: { CONDITION: "type.boolean", DO: command } },
});
