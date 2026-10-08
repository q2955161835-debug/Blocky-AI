import { expect, it } from "vitest";
import { codingEventSchema, codingMessageSchema } from "../src";

const codes = [
  "BLK-MODEL-TRUNCATED-LENGTH", "BLK-MODEL-TRUNCATED-SSE",
  "BLK-MODEL-RESPONSE-SSE", "BLK-MODEL-RESPONSE-JSON",
  "BLK-MODEL-RESPONSE-SHAPE", "BLK-MODEL-RESPONSE-TOOLS",
  "BLK-MODEL-RESPONSE-TOOL-JSON", "BLK-MODEL-RESPONSE-USAGE",
];
it.each(codes)("preserves fixed provider diagnostic %s in bounded events and history", (code) => {
  const event = { schemaVersion: "blocky.coding-event/v1", requestId: "coding1", projectId: "project1",
    sequence: 1, kind: "tool.failed", tool: "blocky_cli", callId: "call1", code };
  expect(codingEventSchema.parse(event).code).toBe(code);
  expect(codingMessageSchema.parse({ id: "message1", role: "assistant", text: code, status: "failed",
    activity: [{ tool: "blocky_cli", callId: "call1", status: "failed", code }],
  }).activity?.[0].code).toBe(code);
  expect(code.length).toBeLessThan(64);
});
it("rejects arbitrary raw failure details as diagnostic codes", () => {
  expect(() => codingEventSchema.parse({ schemaVersion: "blocky.coding-event/v1", requestId: "coding1",
    projectId: "project1", sequence: 1, kind: "tool.failed", code: "BLK-MODEL-RESPONSE: synthetic private response" })).toThrow();
});
