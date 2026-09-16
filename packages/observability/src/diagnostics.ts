import type { LogRecord } from "./bus";
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
>;
/** Export is an allowlist: free text, runtime bodies and terminal payloads never leave the session. */
export function diagnosticRecord(record: LogRecord): DiagnosticRecord {
  if (
    !logChannels.includes(record.channel as (typeof logChannels)[number]) ||
    !["info", "warning", "error"].includes(record.level) ||
    !Number.isSafeInteger(record.sequence) ||
    record.sequence < 0 ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(record.timestamp)
  )
    throw Error("BLK-LOG-004");
  return {
    timestamp: record.timestamp,
    sequence: record.sequence,
    level: record.level,
    channel: record.channel,
  };
}
