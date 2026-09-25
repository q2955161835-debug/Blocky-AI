/** Content-free diagnostic fields. Every imported object is rebuilt, never spread. */
export type TraceDetails = {
  context?: { roleBytes: number; instructionBytes: number; userBytes: number; memoryBytes: number; resultBytes: number; evidenceCount: number; evidenceBytes: number };
  model?: { maxOutputTokens: number };
  memory?: { action: "read" | "write" | "delete"; scope: "session" | "project" };
  tool?: { source: "input" | "result"; inputType: string; inputBytes: number; outputType?: string; outputBytes?: number };
  guard?: { policy: "require" | "optional"; decision: "configured" | "checking" | "passed" | "rejected" | "insufficient-evidence" };
};
const record = (x: unknown): Record<string, unknown> => x !== null && typeof x === "object" && !Array.isArray(x) ? x as Record<string, unknown> : {};
const count = (x: unknown): x is number => typeof x === "number" && Number.isSafeInteger(x) && x >= 0;
const valueType = (x: unknown): x is string => typeof x === "string" && ["null", "array", "object", "string", "number", "boolean"].includes(x);
export function projectTraceDetails(input: unknown): TraceDetails {
  const raw = record(input), result: TraceDetails = {};
  const c = record(raw.context);
  if (["roleBytes", "instructionBytes", "userBytes", "memoryBytes", "resultBytes", "evidenceCount", "evidenceBytes"].every(k => count(c[k])))
    result.context = { roleBytes: Number(c.roleBytes), instructionBytes: Number(c.instructionBytes), userBytes: Number(c.userBytes), memoryBytes: Number(c.memoryBytes), resultBytes: Number(c.resultBytes), evidenceCount: Number(c.evidenceCount), evidenceBytes: Number(c.evidenceBytes) };
  const m = record(raw.model);
  if (count(m.maxOutputTokens) && m.maxOutputTokens > 0 && m.maxOutputTokens <= 4096) result.model = { maxOutputTokens: m.maxOutputTokens };
  const memory = record(raw.memory);
  if ((memory.action === "read" || memory.action === "write" || memory.action === "delete") && (memory.scope === "session" || memory.scope === "project"))
    result.memory = { action: memory.action, scope: memory.scope };
  const t = record(raw.tool);
  if ((t.source === "input" || t.source === "result") && valueType(t.inputType) && count(t.inputBytes))
    result.tool = { source: t.source, inputType: t.inputType, inputBytes: t.inputBytes,
      ...(valueType(t.outputType) ? { outputType: t.outputType } : {}), ...(count(t.outputBytes) ? { outputBytes: t.outputBytes } : {}) };
  const g = record(raw.guard);
  if ((g.policy === "require" || g.policy === "optional") && (g.decision === "configured" || g.decision === "checking" || g.decision === "passed" || g.decision === "rejected" || g.decision === "insufficient-evidence"))
    result.guard = { policy: g.policy, decision: g.decision };
  return result;
}
