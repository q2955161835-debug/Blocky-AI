import { expect, it } from "vitest";
import { inspectTraceExport, TraceSession, EventFactory } from "../src";

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
it("preserves numeric token counters through the real redaction bus and strips nested imported content", () => {
  const factory = new EventFactory(() => "2026-09-26T00:00:00.000Z", () => 1);
  const event = factory.create({ projectId: "project-1", runId: "run-1", type: "run.started", data: {
    usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12, content: "SECRET_NESTED" },
    budget: { steps: 1, calls: 1, reservedOutputTokens: 20, content: "SECRET_NESTED" },
    outputTokens: "SECRET_COUNTER_VALUE", token: 123456,
  } });
  expect(event.data.outputTokens).toBe("[已脱敏]"); expect(event.data.token).toBe("[已脱敏]");
  const trace = new TraceSession(); trace.add(event);
  expect(trace.list()[0].usage).toEqual({ inputTokens: 10, outputTokens: 2, totalTokens: 12 });
  expect(trace.list()[0].budget).toEqual({ steps: 1, calls: 1, reservedOutputTokens: 20 });
  expect(JSON.stringify(trace.export())).not.toContain("SECRET_NESTED");
  const imported = trace.export();
  Object.assign(imported.frames[0].usage!, { content: "SECRET_NESTED" });
  Object.assign(imported.frames[0].budget!, { content: "SECRET_NESTED" });
  expect(JSON.stringify(inspectTraceExport(imported))).not.toContain("SECRET_NESTED");
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
