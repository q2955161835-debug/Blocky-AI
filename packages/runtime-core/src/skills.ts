import { z } from "zod";
import { stableId, type Json } from "@blocky/language-schema";
const id = z.string().max(128).regex(stableId);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const text = (limit: number) => z.string().max(limit).refine(v => !v.includes("\0") && new TextEncoder().encode(v).length <= limit);
export const skillPathSchema = z.string().min(1).max(240).refine(value => value.split("/").every(part =>
  /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(part) && !part.endsWith(".") && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)));
export const skillMetadataSchema = z.object({
  schemaVersion: z.literal("blocky.skill/v1"), skillId: id,
  version: z.string().max(64).regex(/^[0-9]+\.[0-9]+\.[0-9]+(?:-[a-zA-Z0-9.-]+)?$/),
  name: text(128).min(1), summary: text(2048).min(1),
  toolIds: z.array(id).max(32).refine(v => new Set(v).size === v.length),
}).strict();
export const skillFileSchema = z.object({ path: skillPathSchema, sha256: hash,
  bytes: z.array(z.number().int().min(0).max(255)).max(524288) }).strict();
const base = { schemaVersion: z.literal("blocky.skill-request/v1"), requestId: id, projectId: id, sessionId: id };
export const skillRequestSchema = z.discriminatedUnion("action", [
  z.object({ ...base, action: z.literal("discover") }).strict(),
  z.object({ ...base, action: z.literal("install"), metadata: skillMetadataSchema, files: z.array(skillFileSchema).min(1).max(128) }).strict(),
  z.object({ ...base, action: z.literal("load"), skillId: id, expectedDigest: hash }).strict(),
  z.object({ ...base, action: z.literal("read-resource"), skillId: id, expectedDigest: hash, path: skillPathSchema }).strict(),
  z.object({ ...base, action: z.literal("uninstall"), skillId: id, expectedDigest: hash }).strict(),
]).superRefine((request,ctx)=>{
  if(request.action!=="install") return;
  if(request.files.reduce((n,f)=>n+f.bytes.length,0)>2097152) ctx.addIssue({code:"custom",message:"BLK-SKILL-LIMIT"});
  if(new Set(request.files.map(f=>f.path.toLowerCase())).size!==request.files.length || !request.files.some(f=>f.path==="SKILL.md"))
    ctx.addIssue({code:"custom",message:"BLK-SKILL-INVALID"});
});
export type SkillMetadata = z.infer<typeof skillMetadataSchema>;
export type SkillRequest = z.infer<typeof skillRequestSchema>;
export const installedSkillSchema = z.object({ metadata: skillMetadataSchema, digest: hash, installedAt: z.number().int().nonnegative(),
  totalBytes: z.number().int().min(1).max(2097152), files: z.array(z.object({path: skillPathSchema, sha256: hash, byteLength: z.number().int().nonnegative().max(524288)}).strict()).max(128) }).strict();
export type InstalledSkill = z.infer<typeof installedSkillSchema>;
export const skillResultSchema = z.discriminatedUnion("action", [
  z.object({action:z.literal("discover"), skills:z.array(installedSkillSchema).max(64)}).strict(),
  z.object({action:z.literal("install"), skill:installedSkillSchema}).strict(),
  z.object({action:z.literal("load"), skill:installedSkillSchema, body:text(524288)}).strict(),
  z.object({action:z.literal("read-resource"), skillId:id, digest:hash, file:skillFileSchema}).strict(),
  z.object({action:z.literal("uninstall"), ok:z.literal(true)}).strict(),
]);
export type SkillResult = z.infer<typeof skillResultSchema>;
type Input<T> = T extends unknown ? Omit<T,"schemaVersion"|"requestId"|"projectId"|"sessionId"> : never;
export type SkillInput = Input<SkillRequest>;
export type SkillPort = (request: SkillRequest, signal: AbortSignal) => Promise<Json>;
/** Installed text is untrusted context. It never grants capabilities or executes scripts. */
export class InstalledSkills {
  constructor(private port: SkillPort, readonly projectId: string, readonly sessionId: string) {}
  async request(input: SkillInput, signal: AbortSignal): Promise<SkillResult> {
    signal.throwIfAborted();
    const request = skillRequestSchema.parse({...input,schemaVersion:"blocky.skill-request/v1",requestId:`skill-${crypto.randomUUID()}`,projectId:this.projectId,sessionId:this.sessionId});
    const result = skillResultSchema.parse(await this.port(request,signal));
    signal.throwIfAborted();
    if (result.action !== request.action) throw new Error("BLK-SKILL-INVALID");
    return result;
  }
}
/** Intersection only: Skill metadata cannot add tool permissions. */
export function allowedSkillTools(skill: SkillMetadata, registered: readonly string[], granted: readonly string[]): string[] {
  skillMetadataSchema.parse(skill);
  return skill.toolIds.filter(id => registered.includes(id) && granted.includes(id));
}
