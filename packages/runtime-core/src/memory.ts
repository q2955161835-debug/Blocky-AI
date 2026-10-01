import { z } from "zod";
import { stableId, type Json } from "@blocky/language-schema";
const id = z.string().max(128).regex(stableId);
const source = z.string().min(1).max(256).refine(v => !/[\\\u0000-\u001f]/.test(v) && !v.includes("..") && !v.includes("://"));
const base = { schemaVersion: z.literal("blocky.memory-request/v1"), requestId: id, projectId: id, sessionId: id };
export const memoryRequestSchema = z.discriminatedUnion("action", [
  z.object({ ...base, action: z.literal("read"), key: id }).strict(),
  z.object({ ...base, action: z.literal("search"), query: z.string().max(1024).optional(), limit: z.number().int().min(1).max(100).optional() }).strict(),
  z.object({ ...base, action: z.literal("upsert"), key: id, value: z.json(), expectedVersion: z.number().int().nonnegative(), conflictPolicy: z.enum(["replace", "merge", "reject"]),
    sourceRef: source.optional(), summary: z.string().max(2048).optional(), ttlSeconds: z.number().int().min(0).max(3153600000).optional() }).strict(),
  z.object({ ...base, action: z.literal("delete"), key: id, expectedVersion: z.number().int().nonnegative() }).strict(),
  z.object({ ...base, action: z.literal("revoke-source"), sourceRef: source }).strict(),
  z.object({ ...base, action: z.literal("allow-source"), sourceRef: source }).strict(),
  z.object({ ...base, action: z.literal("check-source"), sourceRef: source }).strict(),
]);
export type MemoryRequest = z.infer<typeof memoryRequestSchema>;
type WithoutContext<T> = T extends unknown ? Omit<T, "schemaVersion" | "requestId" | "projectId" | "sessionId"> : never;
export type MemoryInput = WithoutContext<MemoryRequest>;
export const memoryEntrySchema = z.object({
  version: z.number().int().positive(), value: z.json().nullable(), sourceRef: source.nullable(), summary: z.string().max(2048),
  summaryKind: z.enum(["extract", "manual"]), updatedAt: z.number().int().nonnegative(), expiresAt: z.number().int().nonnegative().nullable(),
}).strict();
export type MemoryEntry = z.infer<typeof memoryEntrySchema>;
export type MemoryResult = { readable?:boolean; found?: boolean; version?: number; entry?: MemoryEntry | null; entries?: { key: string; entry: MemoryEntry }[]; ok?: boolean; time?: number };
export function parseMemoryResult(value: unknown): MemoryResult {
  return z.object({ readable:z.boolean().optional(), found: z.boolean().optional(), version: z.number().int().nonnegative().optional(), entry: memoryEntrySchema.nullable().optional(),
    entries: z.array(z.object({key:id,entry:memoryEntrySchema}).strict()).max(100).optional(), ok:z.boolean().optional(),time:z.number().int().nonnegative().optional() }).strict().parse(value);
}
export type MemoryPort = (request: MemoryRequest, signal: AbortSignal) => Promise<Json>;
/** Metadata lives in Host memory, never the project document. */
export class ProjectMemory {
  constructor(private port: MemoryPort, readonly projectId: string, readonly sessionId: string) {}
  async request(input: MemoryInput, signal: AbortSignal) {
    signal.throwIfAborted();
    const request = memoryRequestSchema.parse({schemaVersion:"blocky.memory-request/v1",requestId:`memory-${crypto.randomUUID()}`,projectId:this.projectId,sessionId:this.sessionId,...input});
    const result = parseMemoryResult(await this.port(request,signal));
    signal.throwIfAborted();return result;
  }
}
