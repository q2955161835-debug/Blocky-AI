import { expect, it } from "vitest";
import { RecordingBuffer, recordingReview, type RpaRecordingStart } from "../src/recording";

const request: RpaRecordingStart = {
  schemaVersion: "blocky.rpa-recording-start/v1", sessionId: "recording-one", projectId: "project-one",
  target: { kind: "browser", identity: "https://example.invalid" }, url: "https://example.invalid/form",
};
function captured() {
  const buffer = new RecordingBuffer({ sessionId: request.sessionId, projectId: request.projectId, target: { kind: "browser", identity: "browser:11111111-1111-4111-8111-111111111111" } });
  buffer.append({ action: "fill", locator: { kind: "browser", role: "textbox", name: "Question" } });
  return buffer.seal("stopped");
}
it("maps a sealed isolated browser recording into a new review plan without changing its capture receipt", () => {
  const result = captured(), before = structuredClone(result);
  const draft = recordingReview(result, request);
  expect(draft).toMatchObject({ browserUrl: request.url, plan: { target: request.target, steps: [{ value: { kind: "manual-input" } }] } });
  expect(result).toEqual(before);
  expect(JSON.stringify(draft)).not.toMatch(/grant|approved|authorization/);
});
it("rejects cross-session, cross-project, foreign windows and changed recorded plans", () => {
  const result = captured();
  for (const other of [{ ...result, sessionId: "another-session" }, { ...result, projectId: "another-project" }, { ...result, target: request.target }, { ...result, plan: { ...result.plan, steps: [] } }]) {
    expect(() => recordingReview(other, request)).toThrow();
  }
  const windows: RpaRecordingStart = { ...request, target: { kind: "windows", identity: "window-one" }, url: undefined };
  const buffer = new RecordingBuffer({ sessionId: request.sessionId, projectId: request.projectId, target: { kind: "windows", identity: "window-two" } });
  buffer.append({ action: "click", locator: { kind: "uia", automationId: "save" } });
  expect(() => recordingReview(buffer.seal("stopped"), windows)).toThrow();
});
