import { expect, it } from "vitest";
import { codingMessageSchema, codingEventSchema, codingStartSchema } from "../src";

it("retains cancelled partial text, thinking and safe tool history while accepting old messages", () => {
  const old = { id: "answer-old", role: "assistant", text: "Old reply", status: "completed" };
  expect(codingMessageSchema.parse(old)).toEqual(old);
  const message = {
    ...old, id: "answer-stopped", status: "cancelled", text: "Already displayed text",
    thinking: "Reported model reasoning", activity: [
      { callId: "call-1", tool: "blocky_cli", status: "failed", command: "patch create", code: "BLK-CODING-CLI-ARGS", exitCode: 2 },
      { callId: "call-2", tool: "project_context", status: "cancelled" },
    ], activityTruncated: 0, thinkingTruncated: false,
  };
  expect(codingMessageSchema.parse(message)).toEqual(message);
  expect(codingMessageSchema.safeParse({ ...message, activity: [{ ...message.activity[0], args: ["private"] }] }).success).toBe(false);
  expect(codingMessageSchema.safeParse({ ...message, thinking: "api_key = synthetic-secret" }).success).toBe(false);
});

it("validates thinking deltas and safe command diagnostics without arbitrary arguments", () => {
  const event = { schemaVersion: "blocky.coding-event/v1", requestId: "request-1", projectId: "project-1", sequence: 1, kind: "thinking.delta", text: "Incremental thought" };
  expect(codingEventSchema.parse(event)).toEqual(event);
  expect(codingEventSchema.safeParse({ ...event, command: "project inspect C:/private" }).success).toBe(false);
});

it("adds per-request effort without requiring it in legacy starts", () => {
  const start = { schemaVersion: "blocky.coding-start/v1", requestId: "request-1", projectId: "project-1", moduleId: "main", prompt: "Test", originalJson: "{}", resourceId: "model-1", selection: [], conversation: [] };
  expect(codingStartSchema.parse(start)).toEqual(start);
  expect(codingStartSchema.parse({ ...start, reasoningEffort: "high" }).reasoningEffort).toBe("high");
  expect(codingStartSchema.safeParse({ ...start, reasoningEffort: "unsupported" }).success).toBe(false);
});
