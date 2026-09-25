// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { RpaPanel } from "../../apps/studio-desktop/src/app/RpaPanel";
const io = vi.hoisted(() => ({ targets: vi.fn(), authorize: vi.fn(), cancelAuthorization: vi.fn(), step: vi.fn(), status: vi.fn(), pause: vi.fn(), resume: vi.fn(), stop: vi.fn() }));
vi.mock("../../apps/studio-desktop/src/composition/rpa", () => ({ rpaNative: io }));
beforeEach(() => {
  io.targets.mockResolvedValue([{ identity: "fixture", title: "Owned fixture", processId: 123 }]);
  io.authorize.mockResolvedValue({ sessionId: "session", targetIdentity: "fixture" });
  io.cancelAuthorization.mockResolvedValue(undefined);
  io.step.mockResolvedValue({ found: true }); io.pause.mockResolvedValue(undefined); io.resume.mockResolvedValue(undefined); io.stop.mockResolvedValue(undefined);
  io.status.mockResolvedValue({ status: "completed", active: false, receipts: [] });
});
afterEach(() => { cleanup(); vi.resetAllMocks(); });
async function setup() {
  render(<RpaPanel close={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "刷新窗口列表" }));
  await screen.findByRole("option", { name: "Owned fixture · 123" });
  fireEvent.change(screen.getByLabelText("RPA 目标窗口"), { target: { value: "fixture" } });
}
function add(action = "find", value = "target") {
  fireEvent.change(screen.getByLabelText("动作"), { target: { value: action } });
  fireEvent.change(screen.getByLabelText("RPA 控件定位值"), { target: { value } });
  fireEvent.click(screen.getByRole("button", { name: "添加步骤" }));
}
it("keeps explicitly read data outside execution records", async () => {
  io.step.mockResolvedValue({ text: "fixture-read-content" });
  await setup(); add("read"); fireEvent.click(screen.getByRole("button", { name: "审阅并运行" }));
  await waitFor(() => expect(screen.getByRole("status").textContent).toBe("已完成"));
  expect(within(screen.getByLabelText("自动化执行记录")).queryByText(/fixture-read-content/)).toBeNull();
  expect(screen.getByDisplayValue("fixture-read-content")).toBeTruthy();
  expect(io.authorize.mock.calls[0][0].target.identity).toBe("fixture");
});
it("pauses between steps and waits for explicit resume before the next operation", async () => {
  let finish!: (value: object) => void;
  io.step.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  await setup(); add(); add("find", "second");
  fireEvent.click(screen.getByRole("button", { name: "审阅并运行" }));
  await waitFor(() => expect(io.step).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole("button", { name: "暂停" }));
  await screen.findByRole("button", { name: "继续" });
  await act(async () => { finish({ found: true }); await new Promise((resolve) => setTimeout(resolve, 70)); });
  expect(io.step).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "继续" }));
  await waitFor(() => expect(io.step).toHaveBeenCalledTimes(2));
});
it("retains an uncertain effect and blocks automatic rerun", async () => {
  io.step.mockRejectedValue("BLK-RPA-TIMEOUT-001");
  io.status.mockResolvedValue({ status: "failed", active: false, receipts: [{ stepId: "first", status: "uncertain" }] });
  await setup(); add("click"); fireEvent.click(screen.getByRole("button", { name: "审阅并运行" }));
  await screen.findByText(/结果待核对，请勿重复执行/);
  expect((screen.getByRole("button", { name: "审阅并运行" }) as HTMLButtonElement).disabled).toBe(true);
  expect(io.step).toHaveBeenCalledTimes(1);
});
