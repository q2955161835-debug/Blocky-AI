import {sessionMetadataSchema,type SessionMetadata} from "./session-memory";
import { stableId, agentMessageLimits, type Json } from "@blocky/language-schema";
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
  memoryMetadata?: {projectId:string;key:string;entry:SessionMetadata}[];
  revokedMemorySources?: {projectId:string;source:string}[];
};
const invalid = () => Error("BLK-RUN-STATE");
const id = (value: unknown): value is string =>
  typeof value === "string" && value.length <= 128 && stableId.test(value);
const bytes = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value)).length;

export function parseRuntimeMailbox(input: unknown): RuntimeMailboxState {
  try {
    const value = workflowJson(input, 310000, 160000, 160000);
    if (!Array.isArray(value) || value.length > 128) throw invalid();
    let total = 0;
    for (const message of value) {
      workflowKeys(message, ["projectId", "channel", "payload"]);
      if (!id(message.projectId) || !id(message.channel)) throw invalid();
      workflowJson(message.payload, 16000, 50000, 50000);
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
    const value = workflowJson(input, agentMessageLimits.sessionBytes, 1048576, 1048576);
    workflowKeys(value, [
      "schemaVersion",
      "sessionId",
      "sequence",
      "memory",
      "mailbox",
    ],["memoryMetadata","revokedMemorySources"]);
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
      workflowJson(item.value, agentMessageLimits.historyBytes, 50000, 50000);
      encoded.push([key, item.value]);
    }
    // Match the live Runtime memory budget, including its encoded keys.
    if (bytes(encoded) > agentMessageLimits.sessionBytes) throw invalid();
    if(value.memoryMetadata!==undefined) {
      if(!Array.isArray(value.memoryMetadata)||value.memoryMetadata.length>1024)throw invalid();
      const seen=new Set();for(const item of value.memoryMetadata){workflowKeys(item,["projectId","key","entry"]);if(!id(item.projectId)||!id(item.key))throw invalid();const key=JSON.stringify([item.projectId,item.key]);if(seen.has(key))throw invalid();seen.add(key);sessionMetadataSchema.parse(item.entry);}
      if(bytes(encoded)+bytes(value.memoryMetadata)>agentMessageLimits.sessionBytes)throw invalid();
    }
    if(value.revokedMemorySources!==undefined) {
      if(!Array.isArray(value.revokedMemorySources)||value.revokedMemorySources.length>1024)throw invalid();
      for(const item of value.revokedMemorySources){workflowKeys(item,["projectId","source"]);if(!id(item.projectId)||typeof item.source!=="string"||item.source.length>256)throw invalid();}
    }
    parseRuntimeMailbox(value.mailbox);
    return value as unknown as RuntimeSessionState;
  } catch {
    throw invalid();
  }
}
