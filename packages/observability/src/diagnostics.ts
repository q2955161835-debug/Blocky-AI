import type { LogRecord } from "./bus";
export const diagnosticScopeKeys = [
  "projectId",
  "runId",
  "moduleId",
  "blockId",
  "correlationId",
] as const;
export type DiagnosticScope = Partial<
  Record<(typeof diagnosticScopeKeys)[number], string>
>;
export function projectDiagnosticScope(input: unknown): DiagnosticScope {
  return normalizeDiagnosticScope(input).scope;
}
export function normalizeDiagnosticScope(input: unknown): {
  scope: DiagnosticScope;
  scopeOmitted: boolean;
} {
  if (input === undefined) return { scope: {}, scopeOmitted: false };
  if (!input || typeof input !== "object" || Array.isArray(input))
    return { scope: {}, scopeOmitted: true };
  const source = input as Record<string, unknown>,
    scope: DiagnosticScope = {};
  for (const key of diagnosticScopeKeys) {
    const value = source[key];
    if (
      typeof value === "string" &&
      value.length <= (key === "correlationId" ? 512 : 200) &&
      /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(value)
    )
      scope[key] = value;
  }
  return {
    scope,
    scopeOmitted: Object.entries(source).some(
      ([key, value]) =>
        value !== undefined && scope[key as keyof DiagnosticScope] !== value,
    ),
  };
}
export const logChannels = [
  "runtime",
  "compiler",
  "host",
  "terminal",
  "preview",
  "builder",
] as const;
export type DiagnosticRecord = Pick<
  LogRecord,
  "timestamp" | "sequence" | "level" | "channel"
> & { scope?: DiagnosticScope; scopeOmitted?: true };
/** Export is an allowlist: free text, runtime bodies and terminal payloads never leave the session. */
export function diagnosticRecord(record: LogRecord): DiagnosticRecord {
  if (
    !logChannels.includes(record.channel as (typeof logChannels)[number]) ||
    !["info", "warning", "error"].includes(record.level) ||
    !Number.isSafeInteger(record.sequence) ||
    record.sequence < 0 ||
    (record.scopeOmitted !== undefined && record.scopeOmitted !== true) ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(record.timestamp)
  )
    throw Error("BLK-LOG-004");
  const { scope, scopeOmitted } = normalizeDiagnosticScope(record.scope);
  return {
    timestamp: record.timestamp,
    sequence: record.sequence,
    level: record.level,
    channel: record.channel,
    ...(Object.keys(scope).length ? { scope } : {}),
    ...(scopeOmitted || record.scopeOmitted
      ? { scopeOmitted: true as const }
      : {}),
  };
}
