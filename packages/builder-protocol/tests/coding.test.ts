import { expect, it } from "vitest";
import * as protocol from "../src";
import {
  codingChangeSchema,
  codingResultSchema,
  parseCodingStart,
} from "../src";
const api = protocol as unknown as {
  parseCodingStart(value: unknown): unknown;
  codingEventSchema: { parse(value: unknown): unknown };
};
const start = () => ({
  schemaVersion: "blocky.coding-start/v1",
  requestId: "coding-1",
  projectId: "project-1",
  moduleId: "main",
  prompt: "Read the source and add a test",
  originalJson: "{}",
  resourceId: "model-1",
  selection: [],
  conversation: [],
  workspaceId: "workspace-1",
});
it("rejects credentials and excessive conversation context", () => {
  expect(() =>
    parseCodingStart({ ...start(), prompt: "sk-" + "a".repeat(48) }),
  ).toThrow("BLK-CODING-INPUT");
  expect(() =>
    parseCodingStart({
      ...start(),
      conversation: Array.from({ length: 5 }, () => ({
        role: "user",
        text: "a".repeat(16000),
      })),
    }),
  ).toThrow();
});
it("accepts only bounded diagnostic codes and recent event IDs in runtime context", () => {
  const runtimeContext = {
    diagnostics: [
      {
        code: "BLK-LINK-001",
        severity: "error",
        moduleId: "main",
        blockId: "agent-root",
      },
    ],
    recentEvents: [
      {
        type: "block.failed",
        moduleId: "main",
        blockId: "agent-root",
        code: "BLK-RUN-001",
      },
    ],
  };
  expect(parseCodingStart({ ...start(), runtimeContext }).runtimeContext).toEqual(
    runtimeContext,
  );
  expect(() =>
    parseCodingStart({
      ...start(),
      runtimeContext: {
        ...runtimeContext,
        diagnostics: [{ ...runtimeContext.diagnostics[0], message: "private" }],
      },
    }),
  ).toThrow("BLK-CODING-INPUT");
  expect(() =>
    parseCodingStart({
      ...start(),
      runtimeContext: {
        diagnostics: Array.from({ length: 21 }, () => runtimeContext.diagnostics[0]),
        recentEvents: [],
      },
    }),
  ).toThrow("BLK-CODING-INPUT");
  expect(() =>
    parseCodingStart({
      ...start(),
      runtimeContext: {
        diagnostics: Array.from({ length: 20 }, () => ({
          code: "BLK-LINK-001",
          severity: "error",
          moduleId: "a".repeat(200),
          blockId: "b".repeat(200),
        })),
        recentEvents: [],
      },
    }),
  ).toThrow("BLK-CODING-INPUT");
});
it.each([
  "../escape.ts",
  "/absolute.ts",
  "a/../../b",
  "file:stream",
  "a\\b",
  "a//b",
  "trailing. ",
])("rejects unsafe receipt path %s", (path) => {
  expect(() =>
    codingChangeSchema.parse({
      changeId: "change-1",
      path,
      before: null,
      after: "text",
      beforeDigest: null,
      afterDigest: "a".repeat(64),
    }),
  ).toThrow();
});
it("binds all completion events to the task and rejects duplicate sequence or mismatched file existence", () => {
  const event = {
    schemaVersion: "blocky.coding-event/v1",
    requestId: "coding-1",
    projectId: "project-1",
    sequence: 1,
    kind: "text.delta",
    text: "response",
  };
  const result = {
    schemaVersion: "blocky.coding-result/v1",
    requestId: "coding-1",
    projectId: "project-1",
    baseDigest: "a".repeat(64),
    text: "response",
    changes: [],
    events: [event],
    generations: [],
    engine: "pi",
    modelApiCalled: false,
  };
  expect(() => codingResultSchema.parse(result)).not.toThrow();
  expect(() =>
    codingResultSchema.parse({
      ...result,
      events: [{ ...event, projectId: "project-2" }],
    }),
  ).toThrow();
  expect(() =>
    codingResultSchema.parse({ ...result, events: [event, event] }),
  ).toThrow();
  expect(() =>
    codingChangeSchema.parse({
      changeId: "change-1",
      path: "a.ts",
      before: null,
      after: "text",
      beforeDigest: "a".repeat(64),
      afterDigest: "b".repeat(64),
    }),
  ).toThrow();
});
it("accepts a natural language coding task without builder operation choices", () => {
  expect(() => api.parseCodingStart(start())).not.toThrow();
  expect(api.parseCodingStart(start())).toEqual(start());
});
it.each([
  { intent: "build" },
  { resourceId: "" },
  { selection: ["a", "a"] },
  { prompt: "" },
  {
    conversation: Array.from({ length: 21 }, () => ({
      role: "user",
      text: "previous",
    })),
  },
])("rejects invalid or undeclared coding input %j", (extra) => {
  expect(() => api.parseCodingStart({ ...start(), ...extra })).toThrow();
});
it("accepts bounded live tool events and rejects unexpected fields", () => {
  const event = {
    schemaVersion: "blocky.coding-event/v1",
    requestId: "coding-1",
    projectId: "project-1",
    sequence: 1,
    kind: "tool.started",
    tool: "workspace_read",
    callId: "read-1",
  };
  expect(() => api.codingEventSchema.parse(event)).not.toThrow();
  expect(() =>
    api.codingEventSchema.parse({ ...event, tool: "shell" }),
  ).toThrow();
  expect(() =>
    api.codingEventSchema.parse({ ...event, sequence: 0 }),
  ).toThrow();
  expect(() =>
    api.codingEventSchema.parse({ ...event, credential: "synthetic" }),
  ).toThrow();
});

it("accepts the bounded Host journal after manual undo appends inverse receipts", () => {
  const changes = Array.from({ length: 512 }, (_, index) => ({
    changeId: `change-${index}`,
    path: "src/file.ts",
    before: null,
    after: "text",
    beforeDigest: null,
    afterDigest: "a".repeat(64),
  }));
  expect(() => protocol.codingChangesSchema.parse(changes)).not.toThrow();
  expect(() =>
    protocol.codingChangesSchema.parse([
      ...changes,
      { ...changes[0], changeId: "overflow" },
    ]),
  ).toThrow();
});
