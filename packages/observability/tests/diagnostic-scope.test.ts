import { expect, it } from "vitest";
import { RedactedBus, diagnosticRecord } from "../src";

it("preserves bounded correlation IDs while excluding content and malformed scope values", () => {
  const bus = new RedactedBus();
  bus.write(
    "runtime",
    "info",
    "private message",
    { body: "secret body" },
    {
      projectId: "project-a",
      runId: "run-a",
      moduleId: "main",
      blockId: "step-1",
      correlationId: "call-1",
    },
  );
  expect(bus.export().records[0].scope).toEqual({
    projectId: "project-a",
    runId: "run-a",
    moduleId: "main",
    blockId: "step-1",
    correlationId: "call-1",
  });
  const result = diagnosticRecord({
    ...bus.records[0],
    scope: {
      runId: "Bearer private-value",
      moduleId: "x".repeat(201),
      blockId: "step-1",
      body: "private-body",
    },
  });
  expect(result.scope).toEqual({ blockId: "step-1" });
  expect(result.scopeOmitted).toBe(true);
  expect(JSON.stringify(result)).not.toContain("private");
  const correlationId = `run-${"a".repeat(36)}-${"b".repeat(160)}-1`;
  expect(correlationId.length).toBe(203);
  expect(
    diagnosticRecord({ ...bus.records[0], scope: { correlationId } }).scope
      ?.correlationId,
  ).toBe(correlationId);
  bus.write("runtime", "info", "safe", {}, { blockId: "b".repeat(201) });
  expect(bus.records[1].scope).toEqual({});
  expect(bus.export().records[1].scopeOmitted).toBe(true);
  expect(
    diagnosticRecord(bus.export().records[1] as (typeof bus.records)[number])
      .scopeOmitted,
  ).toBe(true);
});
