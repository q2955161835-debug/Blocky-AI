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

it("keeps bounded structural metadata but never imports arbitrary step contents", () => {
  const trace = new TraceSession();
  trace.add({ eventVersion: "blocky.event/v1alpha1", projectId: "project-1", runId: "run-1", sequence: 1,
    timestamp: "2026-09-26T00:00:00.000Z", type: "block.completed", blockId: "block-1",
    data: { blockType: "core.message.reply", inputPorts: ["CONTENT", "HANDLER"], outputType: "string", outputBytes: 42,
      transport: "remote", model: "deepseek-v4-pro", budget: { steps: 2, calls: 1, reservedOutputTokens: 8 }, content: "SECRET_BODY" },
    redaction: { applied: false, categories: [] } });
  const exported = trace.export();
  expect(exported.frames[0]).toMatchObject({ blockType: "core.message.reply", inputPorts: ["CONTENT", "HANDLER"], outputType: "string",
    outputBytes: 42, transport: "remote", model: "deepseek-v4-pro", budget: { steps: 2, calls: 1, reservedOutputTokens: 8 } });
  expect(JSON.stringify(exported)).not.toContain("SECRET_BODY");
  const injected = structuredClone(exported);
  (injected.frames[0] as object & { content?: string }).content = "SECRET_BODY";
  expect(JSON.stringify(inspectTraceExport(injected))).not.toContain("SECRET_BODY");
  injected.frames[0].inputPorts = ["secret content with spaces"];
  expect(inspectTraceExport(injected).frames[0].inputPorts).toBeUndefined();
});
