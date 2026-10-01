import {sessionMetadataSchema,type SessionMetadata} from "../session-memory";
import { stableId, type Json } from "@blocky/language-schema";
import type { OutputFile } from "../agent-context";
import { requireWorkflow, workflowJson, workflowKeys } from "./protocol";

export type MailboxCheckpoint = { channel: string; payload: Json }[];
export type AgentCheckpoint = {
  schemaVersion: "blocky.workflow-agent/v1";
  projectId: string;
  question: string;
  value: Json;
  memory: Json;
  instruction: string;
  requireEvidence: boolean;
  generated?: string;
  structured?: Json;
  files: OutputFile[];
  sessionMemory: { key: string; value: Json }[];
  events: MailboxCheckpoint;
  memoryBinding?:{scope:"session"|"project";keys:{key:string;version:number}[]};
  imageBinding?:{mediaId:string;sha256:string;version:number};
  mediaBinding?:{mediaId:string;sha256:string;version:number};
  sessionMemoryMetadata?:{key:string;entry:SessionMetadata}[];
  revokedMemorySources?:string[];
};
export type BudgetCheckpoint = {
  steps: number;
  calls: number;
  usedOutput: number;
  maxSteps: number;
  maxCalls: number;
  maxOutput: number;
  remainingMs: number;
};
const validId = (v: unknown): v is string =>
  typeof v === "string" && v.length <= 128 && stableId.test(v);
const text = (v: unknown, max: number) =>
  typeof v === "string" && new TextEncoder().encode(v).length <= max;
export function parseMailboxCheckpoint(input: unknown): MailboxCheckpoint {
  const value = workflowJson(input, 270000);
  requireWorkflow(Array.isArray(value) && value.length <= 128);
  let bytes = 0;
  for (const item of value) {
    workflowKeys(item, ["channel", "payload"]);
    requireWorkflow(validId(item.channel));
    workflowJson(item.payload, 16000);
    bytes += new TextEncoder().encode(JSON.stringify(item.payload)).length;
  }
  requireWorkflow(bytes <= 262144, "BLK-EVENT-002");
  return value as MailboxCheckpoint;
}
export function parseAgentCheckpoint(input: unknown): AgentCheckpoint {
  const v = workflowJson(input);
  workflowKeys(
    v,
    [
      "schemaVersion",
      "projectId",
      "question",
      "value",
      "memory",
      "instruction",
      "requireEvidence",
      "files",
      "sessionMemory",
      "events",
    ],
    ["generated", "structured", "sessionMemoryMetadata", "revokedMemorySources", "memoryBinding", "imageBinding", "mediaBinding"],
  );
  requireWorkflow(
    v.schemaVersion === "blocky.workflow-agent/v1" &&
      validId(v.projectId) &&
      text(v.question, 16000) &&
      text(v.instruction, 8192) &&
      typeof v.requireEvidence === "boolean",
  );
  if (Object.hasOwn(v, "generated")) requireWorkflow(text(v.generated, 65536));
  requireWorkflow(Array.isArray(v.files) && v.files.length <= 8);
  for (const file of v.files) {
    workflowKeys(file, ["name", "format", "content"]);
    requireWorkflow(
      typeof file.name === "string" &&
        /^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,79}$/u.test(file.name) &&
        !/[. ]$/.test(file.name) &&
        !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(file.name) &&
        ["text", "json"].includes(String(file.format)) &&
        text(file.content, 65536),
    );
  }
  requireWorkflow(
    Array.isArray(v.sessionMemory) && v.sessionMemory.length <= 1024,
  );
  const seen = new Set<string>();
  for (const entry of v.sessionMemory) {
    workflowKeys(entry, ["key", "value"]);
    requireWorkflow(validId(entry.key) && !seen.has(entry.key));
    seen.add(entry.key);
    workflowJson(entry.value, 32768);
  }
  if(v.sessionMemoryMetadata!==undefined){requireWorkflow(Array.isArray(v.sessionMemoryMetadata)&&v.sessionMemoryMetadata.length<=1024);const seen=new Set();for(const item of v.sessionMemoryMetadata){workflowKeys(item,["key","entry"]);requireWorkflow(validId(item.key)&&!seen.has(item.key));seen.add(item.key);sessionMetadataSchema.parse(item.entry);}}
  if(v.revokedMemorySources!==undefined){requireWorkflow(Array.isArray(v.revokedMemorySources)&&v.revokedMemorySources.length<=1024);for(const source of v.revokedMemorySources)requireWorkflow(typeof source==='string'&&source.length<=256);}
  if(v.memoryBinding!==undefined){const binding=v.memoryBinding;workflowKeys(binding,["scope","keys"]);requireWorkflow(typeof binding.scope==='string'&&['session','project'].includes(binding.scope)&&Array.isArray(binding.keys)&&binding.keys.length<=100);const seen=new Set();for(const ref of binding.keys){workflowKeys(ref,["key","version"]);requireWorkflow(validId(ref.key)&&!seen.has(ref.key)&&typeof ref.version==='number'&&Number.isSafeInteger(ref.version)&&ref.version>0);seen.add(ref.key);}}
  parseMailboxCheckpoint(v.events);
  if(v.imageBinding!==undefined){const image=v.imageBinding;workflowKeys(image,['mediaId','sha256','version']);requireWorkflow(validId(image.mediaId)&&typeof image.sha256==='string'&&/^[a-f0-9]{64}$/.test(image.sha256)&&typeof image.version==='number'&&Number.isSafeInteger(image.version)&&image.version>0);}
  if(v.mediaBinding!==undefined){const image=v.mediaBinding;workflowKeys(image,['mediaId','sha256','version']);requireWorkflow(validId(image.mediaId)&&typeof image.sha256==='string'&&/^[a-f0-9]{64}$/.test(image.sha256)&&typeof image.version==='number'&&Number.isSafeInteger(image.version)&&image.version>0);}
  return v as unknown as AgentCheckpoint;
}
export function parseBudgetCheckpoint(input: unknown): BudgetCheckpoint {
  const v = workflowJson(input, 1024);
  workflowKeys(v, [
    "steps",
    "calls",
    "usedOutput",
    "maxSteps",
    "maxCalls",
    "maxOutput",
    "remainingMs",
  ]);
  for (const [key, max, min] of [
    ["steps", 2000, 0],
    ["calls", 16, 0],
    ["usedOutput", 4096, 0],
    ["maxSteps", 2000, 1],
    ["maxCalls", 16, 1],
    ["maxOutput", 4096, 1],
    ["remainingMs", 120000, 0],
  ] as const) {
    requireWorkflow(
      typeof v[key] === "number" &&
        Number.isSafeInteger(v[key]) &&
        v[key] >= min &&
        v[key] <= max,
    );
  }
  const result = v as BudgetCheckpoint;
  requireWorkflow(
    result.steps <= result.maxSteps &&
      result.calls <= result.maxCalls &&
      result.usedOutput <= result.maxOutput,
  );
  return result;
}
