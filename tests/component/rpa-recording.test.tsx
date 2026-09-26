// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { RecordingBuffer, type RpaRecordingStart } from "../../packages/rpa-core/src/recording";
import { RpaPanel } from "../../apps/studio-desktop/src/app/RpaPanel";
const io = vi.hoisted(() => ({ recordStart: vi.fn(), recordStop: vi.fn(), recordStatus: vi.fn(), authorize: vi.fn(), step: vi.fn(), stop: vi.fn(), checkpoints: vi.fn() }));
vi.mock("../../apps/studio-desktop/src/composition/rpa", () => ({ rpaNative: io }));
let capturedRequest: RpaRecordingStart;
beforeEach(() => {
  io.recordStart.mockImplementation(async (request: RpaRecordingStart) => { capturedRequest = request; return { sessionId: request.sessionId, state: "recording", count: 0 }; });
  io.recordStatus.mockImplementation(async () => ({ sessionId: capturedRequest.sessionId, state: "recording", count: 1, omitted: 0 }));
  io.recordStop.mockImplementation(async (_project: string, sessionId: string) => {
    const buffer = new RecordingBuffer({ projectId: capturedRequest.projectId, sessionId, target: { kind: "browser", identity: "browser:11111111-1111-4111-8111-111111111111" } });
    buffer.append({ action: "fill", locator: { kind: "browser", role: "textbox", name: "Question" } });
    return { sessionId, state: "stopped", settled: true, recording: buffer.seal("stopped") };
  });
});
afterEach(() => { cleanup(); vi.resetAllMocks(); vi.useRealTimers(); });
function open(draft = vi.fn(async () => {})) {
  const view = render(<RpaPanel projectId="project-one" draft={draft} close={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("目标类型"), { target: { value: "browser" } });
  fireEvent.change(screen.getByLabelText("起始网址"), { target: { value: "https://example.invalid/form" } });
  fireEvent.click(screen.getByRole("button", { name: "开始录制" }));
  return { ...view, draft };
}
it("locks the target, settles capture, then opens a ghost proposal without execution or typed values", async () => {
  const { draft } = open();
  await screen.findByText(/录制中/);
  expect(screen.getByLabelText("起始网址").matches(":disabled")).toBe(true);
  expect(io.authorize).not.toHaveBeenCalled();
  expect(draft).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "停止录制" }));
  fireEvent.click(await screen.findByRole("button", { name: "审阅录制积木" }));
  await waitFor(() => expect(draft).toHaveBeenCalledOnce());
  expect(draft.mock.calls[0]).toMatchObject([{ target: { kind: "browser", identity: "https://example.invalid" }, steps: [{ action: "fill", value: { kind: "manual-input" } }] }, "https://example.invalid/form"]);
  expect(io.step).not.toHaveBeenCalled();
});
it("cancels a pending native prompt and ignores a late successful start", async () => {
  let late!: (value: unknown) => void;
  io.recordStart.mockImplementation((request: RpaRecordingStart) => { capturedRequest = request; return new Promise(resolve => { late = resolve; }); });
  io.recordStop.mockImplementation(async (_project: string, sessionId: string) => ({ sessionId, state: "stopped", settled: true, recording: null }));
  const { draft } = open();
  await screen.findByText("等待录制授权");
  fireEvent.click(screen.getByRole("button", { name: "停止录制" }));
  await screen.findByText("已取消录制");
  await act(async () => { late({ sessionId: capturedRequest.sessionId, state: "recording", count: 0 }); });
  expect(screen.queryByText(/录制中/)).toBeNull();
  expect(io.recordStatus).not.toHaveBeenCalled();
  expect(draft).not.toHaveBeenCalled();
});
it("retains an unconfirmed settlement, prevents a new capture and lets the user retry stopping", async () => {
  io.recordStop.mockRejectedValueOnce("BLK-RPA-SETTLEMENT-001");
  open(); await screen.findByText(/录制中/);
  fireEvent.click(screen.getByRole("button", { name: "停止录制" }));
  await screen.findByText(/BLK-RPA-SETTLEMENT-001/);
  expect((screen.getByRole("button", { name: "开始录制" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByRole("button", { name: "审阅录制积木" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "停止录制" }));
  await screen.findByRole("button", { name: "审阅录制积木" });
});
it("stops its owned session when the panel is unmounted", async () => {
  const view = open(); await screen.findByText(/录制中/); view.unmount();
  await waitFor(() => expect(io.recordStop).toHaveBeenCalledWith("project-one", capturedRequest.sessionId));
});
it("rejects a different session's recording instead of showing a proposal", async () => {
  io.recordStop.mockResolvedValue({ sessionId: "another-session", state: "stopped", settled: true, recording: null });
  open(); await screen.findByText(/录制中/);
  fireEvent.click(screen.getByRole("button", { name: "停止录制" }));
  await screen.findByText(/BLK-RPA-RECORD-001/);
  expect(screen.queryByRole("button", { name: "审阅录制积木" })).toBeNull();
});
it("polls the owned recording and settles an automatic capture limit before exposing the draft", async () => {
  io.recordStatus.mockImplementation(async () => ({ sessionId: capturedRequest.sessionId, state: "stopped", count: 1, omitted: 0, reason: "limit" }));
  open(); await screen.findByText(/录制中/);
  await screen.findByRole("button", { name: "审阅录制积木" }, { timeout: 2500 });
  expect(io.recordStatus).toHaveBeenCalledWith("project-one", capturedRequest.sessionId);
  expect(io.recordStop).toHaveBeenCalledOnce();
});
it("unlocks after a failed start when the Host explicitly confirms settled error state", async () => {
  io.recordStart.mockImplementation(async (request: RpaRecordingStart) => { capturedRequest = request; throw Error("BLK-RPA-WORKER-001"); });
  io.recordStop.mockImplementation(async (_project: string, sessionId: string) => ({ sessionId, state: "stopped", settled: true, recording: null, code: "BLK-RPA-WORKER-001" }));
  open(); await screen.findByText("BLK-RPA-WORKER-001");
  expect((screen.getByRole("button", { name: "开始录制" }) as HTMLButtonElement).disabled).toBe(false);
  expect(screen.getByLabelText("起始网址").matches(":disabled")).toBe(false);
});
