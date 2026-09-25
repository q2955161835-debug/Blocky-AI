import { expect, it } from "vitest";
import { inspectTraceExport, TraceSession } from "../src";

it("rejects injected text in imported trace metadata", () => {
  const trace = new TraceSession();
  trace.add({ eventVersion: "blocky.event/v1alpha1", projectId: "project-1", runId: "run-1", sequence: 1,
    timestamp: "2026-09-26T00:00:00.000Z", type: "run.started", data: { summary: "secret body" },
    redaction: { applied: false, categories: [] } });
  const exported = trace.export();
  expect(JSON.stringify(inspectTraceExport(exported))).not.toContain("secret body");
  const injected = structuredClone(exported);
  injected.frames[0].timestamp += "SECRET";
  expect(() => inspectTraceExport(injected)).toThrow("BLK-TRACE-003");
  injected.frames[0].timestamp = "2026-09-26T00:00:00.000Z";
  injected.frames[0].correlationId = "secret content with spaces";
  expect(() => inspectTraceExport(injected)).toThrow("BLK-TRACE-003");
});
