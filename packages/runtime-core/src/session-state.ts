import { stableId, type Json } from "@blocky/language-schema";
import { workflowJson, workflowKeys } from "./workflow/protocol";

// Private, transient Host/worker state. Never a project artifact or an execution receipt.
export type RuntimeMailboxState = {
  projectId: string;
  channel: string;
  payload: Json;
}[];
export type RuntimeSessionState = {
  schemaVersion: "blocky.runtime-state/v1";
  sessionId: string;
  sequence: number;
  memory: { projectId: string; key: string; value: Json }[];
  mailbox: RuntimeMailboxState;
};
const invalid = () => Error("BLK-RUN-STATE");
const id = (value: unknown): value is string =>
  typeof value === "string" && value.length <= 128 && stableId.test(value);
const bytes = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value)).length;

export function parseRuntimeMailbox(input: unknown): RuntimeMailboxState {
  try {
    const value = workflowJson(input, 310000, 160000, 36);
    if (!Array.isArray(value) || value.length > 128) throw invalid();
    let total = 0;
    for (const message of value) {
      workflowKeys(message, ["projectId", "channel", "payload"]);
      if (!id(message.projectId) || !id(message.channel)) throw invalid();
      workflowJson(message.payload, 16000);
      total += bytes(message.payload);
    }
    if (total > 262144) throw invalid();
    return value as RuntimeMailboxState;
  } catch {
    throw invalid();
  }
}

export function parseRuntimeSession(input: unknown): RuntimeSessionState {
  try {
    const value = workflowJson(input, 2 * 1024 * 1024, 1048576, 36);
    workflowKeys(value, [
      "schemaVersion",
      "sessionId",
      "sequence",
      "memory",
      "mailbox",
    ]);
    if (
      value.schemaVersion !== "blocky.runtime-state/v1" ||
      !id(value.sessionId) ||
      typeof value.sequence !== "number" ||
      !Number.isSafeInteger(value.sequence) ||
      value.sequence < 0 ||
      value.sequence > Number.MAX_SAFE_INTEGER - 100000 ||
      !Array.isArray(value.memory)
    )
      throw invalid();
    const seen = new Set<string>();
    const encoded = [];
    for (const item of value.memory) {
      workflowKeys(item, ["projectId", "key", "value"]);
      if (!id(item.projectId) || !id(item.key)) throw invalid();
      const key = JSON.stringify([item.projectId, value.sessionId, item.key]);
      if (seen.has(key)) throw invalid();
      seen.add(key);
      workflowJson(item.value, 32768);
      encoded.push([key, item.value]);
    }
    // Match the live Runtime memory budget, including its encoded keys.
    if (bytes(encoded) > 1048576) throw invalid();
    parseRuntimeMailbox(value.mailbox);
    return value as unknown as RuntimeSessionState;
  } catch {
    throw invalid();
  }
}
