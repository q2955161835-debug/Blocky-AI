import { redact } from "./redact";
import { diagnosticRecord } from "./diagnostics";
import type { Json } from "@blocky/language-schema";
export type LogRecord = {
  schemaVersion: "blocky.log/v1alpha1";
  logId: string;
  timestamp: string;
  sequence: number;
  level: "info" | "warning" | "error";
  kind: "component";
  channel: string;
  scope: Record<string, string>;
  message: string;
  attributes: Record<string, Json>;
  redaction: { applied: boolean; categories: string[] };
  retentionClass: "session";
};
export class RedactedBus {
  records: LogRecord[] = [];
  dropped = 0;
  droppedImportant = 0;
  private sequence = 0;
  private listeners = new Set<(record?: LogRecord) => void>();
  subscribe = (listener: (record?: LogRecord) => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private notify(record?: LogRecord) {
    for (const listener of this.listeners) listener(record);
  }
  constructor(
    private count = 500,
    private bytes = 262144,
  ) {
    if (count < 1 || bytes < 512) throw Error("BLK-LOG-001");
  }
  write(
    channel: string,
    level: LogRecord["level"],
    message: string,
    attributes: Record<string, Json> = {},
  ) {
    if (
      ![
        "runtime",
        "compiler",
        "host",
        "terminal",
        "preview",
        "builder",
      ].includes(channel)
    )
      throw Error("BLK-LOG-002");
    const clean = redact({ message, attributes });
    const value = clean.value as {
      message: string;
      attributes: Record<string, Json>;
    };
    this.push({
      schemaVersion: "blocky.log/v1alpha1",
      logId: `log-${++this.sequence}`,
      timestamp: new Date().toISOString(),
      sequence: this.sequence,
      level,
      kind: "component",
      channel,
      scope: {},
      ...value,
      redaction: clean.redaction,
      retentionClass: "session",
    });
  }
  ingest(record: unknown): string | undefined {
    const cleaned = redact(record);
    if (cleaned.redaction.applied) return "BLK-LOG-004";
    return "BLK-LOG-002";
  }
  private push(record: LogRecord) {
    const size = (x: unknown) =>
      new TextEncoder().encode(JSON.stringify(x)).length;
    if (size(record) > this.bytes) {
      this.dropped++;
      if (record.level !== "info") this.droppedImportant++;
      this.notify();
      return;
    }
    this.records.push(record);
    while (
      this.records.length > this.count ||
      size(this.records) > this.bytes
    ) {
      const i = this.records.findIndex((r) => r.level === "info");
      const [removed] = this.records.splice(i < 0 ? 0 : i, 1);
      this.dropped++;
      if (removed.level !== "info") this.droppedImportant++;
    }
    this.notify(record);
  }
  clearView() {
    this.records = [];
    this.notify();
  }
  export() {
    return {
      schemaVersion: "blocky.diagnostics/v1",
      records: this.records.map(diagnosticRecord),
      dropped: this.dropped,
      droppedImportant: this.droppedImportant,
    };
  }
}
