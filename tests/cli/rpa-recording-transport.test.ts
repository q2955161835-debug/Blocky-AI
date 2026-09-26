import { afterEach, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { RecordingBuffer } from "../../packages/rpa-core/src/recording";
const mock = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: mock.spawn }));
vi.mock("node:fs", () => ({ existsSync: () => true }));
vi.mock("../../tools/blocky-cli/src/native-store", () => ({ helper: "owned-helper" }));
import { recordNativeRpa } from "../../tools/blocky-cli/src/rpa-recording-transport";
class Pipe extends EventEmitter { destroyed = false; setEncoding() {} resume() {} write = vi.fn(); destroy() { this.destroyed = true; } }
function child() { const value = Object.assign(new EventEmitter(), { stdin: new Pipe(), stdout: new Pipe(), stderr: new Pipe(), kill: vi.fn(() => false), unref: vi.fn() }); mock.spawn.mockReturnValue(value); return value; }
const request = { schemaVersion: "blocky.rpa-recording-start/v1" as const, projectId: "project-one", sessionId: "recording-one", target: { kind: "windows" as const, identity: "owned-window" } };
const frame = (type: string, sequence: number, value: unknown) => JSON.stringify({ schemaVersion: "blocky.rpa-recording-session/v1", type, sequence, value }) + "\n";
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });
it("requires both a matching result and confirmed settlement plus child exit", async () => {
  const process = child(), onEvent = vi.fn(), controller = new AbortController();
  const running = recordNativeRpa(request, { signal: controller.signal, controlStdin: false, onEvent });
  const buffer = new RecordingBuffer({ projectId: request.projectId, sessionId: request.sessionId, target: request.target });
  buffer.append({ action: "click", locator: { kind: "uia", automationId: "save" } });
  const result = buffer.seal("stopped");
  process.stdout.emit("data", frame("status", 1, { sessionId: request.sessionId, state: "recording", count: 1 }));
  process.stdout.emit("data", frame("recording", 2, { sessionId: request.sessionId, state: "stopped", settled: true, recording: result }));
  process.stdout.emit("data", frame("settled", 3, { settled: true }));
  process.emit("close", 0);
  expect(await running).toEqual(result);
  expect(onEvent).toHaveBeenCalledTimes(3);
});
it("bounds stop even when kill fails and no close event arrives", async () => {
  vi.useFakeTimers(); const process = child(), controller = new AbortController();
  const running = recordNativeRpa(request, { signal: controller.signal, controlStdin: false, onEvent: vi.fn() });
  const rejected = expect(running).rejects.toThrow("BLK-RPA-SETTLEMENT-001");
  controller.abort(); await vi.advanceTimersByTimeAsync(7500); await rejected;
  expect(process.kill).toHaveBeenCalledOnce(); expect(process.unref).toHaveBeenCalledOnce();
});
it("rejects out of order and foreign-session frames before exposing them", async () => {
  const process = child(), onEvent = vi.fn();
  const running = recordNativeRpa(request, { signal: new AbortController().signal, controlStdin: false, onEvent });
  const rejected = expect(running).rejects.toThrow("BLK-RPA-WORKER-001");
  process.stdout.emit("data", frame("status", 2, { sessionId: "foreign", state: "recording", count: 1 }));
  process.emit("close", 1); await rejected;
  expect(onEvent).not.toHaveBeenCalled();
});
it("does not report a stored result as success when settlement is unconfirmed", async () => {
  const process = child();
  const running = recordNativeRpa(request, { signal: new AbortController().signal, controlStdin: false, onEvent: vi.fn() });
  const rejected = expect(running).rejects.toThrow("BLK-RPA-SETTLEMENT-001");
  process.stdout.emit("data", frame("settled", 1, { settled: false, code: "BLK-RPA-SETTLEMENT-001" }));
  process.emit("close", 1); await rejected;
});
