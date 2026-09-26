import { expect, it } from "vitest";
import { RecordingBuffer, rpaRecordingResultSchema, rpaRecordingStartSchema } from "../src/recording";

it("binds recording consent to one project and origin without accepting input fields", () => {
  const start = { schemaVersion:"blocky.rpa-recording-start/v1",sessionId:"recording-one",projectId:"project-one",target:{kind:"browser",identity:"https://example.invalid"},url:"https://example.invalid/form" };
  expect(rpaRecordingStartSchema.safeParse(start).success).toBe(true);
  for (const request of [{...start,url:"https://other.invalid/form"},{...start,url:"https://user:password@example.invalid/form"},{...start,input:"PRIVATE"},{...start,target:{kind:"windows",identity:"window-one"}}]) {
    expect(rpaRecordingStartSchema.safeParse(request).success).toBe(false);
  }
});

const options = {
  sessionId: "recording-one", projectId: "project-one",
  target: { kind: "browser" as const, identity: "browser:11111111-1111-1111-1111-111111111111" },
};
const fill = { action: "fill", locator: { kind: "browser", role: "textbox", name: "Question" }, sensitive: false };

it("records metadata only, coalesces adjacent input and seals a reviewable plan without granting execution", () => {
  let now = 1000;
  const buffer = new RecordingBuffer(options, () => now);
  expect(buffer.append(fill)).toBe(true);
  expect(buffer.append(fill)).toBe(true);
  expect(buffer.append({ ...fill, value: "NEVER_STORE_TYPED_CONTENT" })).toBe(false);
  expect(buffer.append({ action: "click", locator: { kind: "browser", role: "button", name: "Save" } })).toBe(true);
  now += 500;
  const draft = buffer.seal("stopped");
  expect(rpaRecordingResultSchema.parse(draft)).toEqual(draft);
  expect(draft).toMatchObject({ requiresReview: true, reason: "stopped", omitted: 1, startedAt: 1000, stoppedAt: 1500 });
  expect(draft.actions).toHaveLength(2);
  expect(draft.plan?.steps[0]).toMatchObject({ action: "fill", value: { kind: "manual-input" } });
  expect(JSON.stringify(draft)).not.toContain("NEVER_STORE_TYPED_CONTENT");
  expect(JSON.stringify(draft)).not.toMatch(/grant|approved|authorization/);
  expect(buffer.append(fill)).toBe(false);
  draft.actions.length = 0;
  expect(buffer.seal("expired").actions).toHaveLength(2);
  expect(buffer.seal("expired").reason).toBe("stopped");
});

it("bounds count and time independently, and never upgrades omitted input into executable work", () => {
  let now = 100;
  const buffer = new RecordingBuffer(options, () => now);
  for (let i = 0; i < 100; i++) expect(buffer.append({ action: "click", locator: { kind: "browser", role: "button", name: `Step ${i}` } })).toBe(true);
  expect(buffer.status()).toMatchObject({ state: "stopped", reason: "limit", count: 100 });
  expect(buffer.append(fill)).toBe(false);
  expect(buffer.seal("stopped").actions).toHaveLength(100);
  const timed = new RecordingBuffer(options, () => now);
  now += 600000;
  expect(timed.append(fill)).toBe(false);
  expect(timed.seal("stopped")).toMatchObject({ reason: "expired", actions: [] });
  expect(timed.seal("stopped").plan).toBeUndefined();
});

it("rejects foreign targets, ambiguous locators, coordinate fallback, credentials and unbounded metadata", () => {
  const buffer = new RecordingBuffer(options);
  const rejected = [
    { action: "click", locator: { kind: "uia", name: "Other app" } },
    { action: "click", locator: { kind: "coordinate", x: 1, y: 1, riskAccepted: true } },
    { action: "click", locator: { kind: "browser", role: "button" } },
    { action: "click", locator: { kind: "browser", role: "button", name: "Bearer abcdefghijklmnopqrstuvwxyz" } },
    { action: "fill", locator: { kind: "browser", role: "textbox", name: "password=private-value" } },
    { action: "fill", locator: { kind: "browser", role: "textbox", name: "x".repeat(201) } },
    { action: "read", locator: { kind: "browser", role: "textbox", name: "Input" } },
  ];
  for (const input of rejected) expect(buffer.append(input)).toBe(false);
  expect(buffer.status()).toMatchObject({ count: 0, omitted: rejected.length });
  expect(buffer.seal("target-lost")).toMatchObject({ reason: "target-lost", actions: [] });
  const windows = new RecordingBuffer({ ...options, target: { kind: "windows", identity: "window-one" } });
  expect(windows.append({ action: "click", locator: { kind: "uia", controlType: "Button" } })).toBe(false);
  expect(windows.append({ action: "click", locator: { kind: "uia", automationId: "submit", controlType: "Button" } })).toBe(true);
});

it("seals long Unicode locators before the private wire budget is exceeded", () => {
  const buffer = new RecordingBuffer({ ...options, target: { kind: "windows", identity: "window-one" } });
  for (let i = 0; i < 100; i++) buffer.append({ action: "click", locator: { kind: "uia", automationId: `control-${i}`, name: "界".repeat(200), controlType: "Button" } });
  const result = buffer.seal("stopped");
  expect(result.reason).toBe("limit");
  expect(result.actions.length).toBeGreaterThan(0);
  expect(result.actions.length).toBeLessThan(100);
  expect(new TextEncoder().encode(JSON.stringify(result)).length).toBeLessThan(60000);
});
