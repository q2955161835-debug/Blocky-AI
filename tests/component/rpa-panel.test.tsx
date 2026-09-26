// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { RpaPanel } from "../../apps/studio-desktop/src/app/RpaPanel";
const io = vi.hoisted(() => ({ recoveryPreview: vi.fn(), recover: vi.fn(), checkpoints: vi.fn(), targets: vi.fn(), authorize: vi.fn(), cancelAuthorization: vi.fn(), step: vi.fn(), status: vi.fn(), pause: vi.fn(), resume: vi.fn(), stop: vi.fn() }));
vi.mock("../../apps/studio-desktop/src/composition/rpa", () => ({ rpaNative: io }));
beforeEach(() => {
  io.checkpoints.mockResolvedValue([]);
  io.targets.mockResolvedValue([{ identity: "fixture", title: "Owned fixture", processId: 123 }]);
  io.authorize.mockResolvedValue({ sessionId: "session", targetIdentity: "fixture" });
  io.cancelAuthorization.mockResolvedValue(undefined);
  io.step.mockResolvedValue({ found: true }); io.pause.mockResolvedValue(undefined); io.resume.mockResolvedValue(undefined); io.stop.mockResolvedValue(undefined);
  io.status.mockResolvedValue({ status: "completed", active: false, receipts: [] });
});
it("requires a renewed risk checkbox before each browser coordinate step and preserves the reviewed coordinates", async () => {
  render(<RpaPanel projectId="coordinate-project" close={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("目标类型"), { target: { value: "browser" } });
  fireEvent.change(screen.getByLabelText("起始网址"), { target: { value: "https://example.test/" } });
  fireEvent.click(screen.getByText("坐标回退（高风险）"));
  const addCoordinate = screen.getByRole("button", { name: "添加坐标点击" }) as HTMLButtonElement;
  fireEvent.change(screen.getByLabelText("坐标 X"), { target: { value: "50" } });
  fireEvent.change(screen.getByLabelText("坐标 Y"), { target: { value: "60" } });
  expect(addCoordinate.disabled).toBe(true);
  fireEvent.click(screen.getByRole("checkbox", { name: "我已核对坐标并接受误点风险" }));
  expect(addCoordinate.disabled).toBe(false);
  fireEvent.change(screen.getByLabelText("坐标 X"), { target: { value: "1100" } });
  expect(addCoordinate.disabled).toBe(true);
  fireEvent.click(screen.getByRole("checkbox", { name: "我已核对坐标并接受误点风险" }));
  expect(addCoordinate.disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("坐标 X"), { target: { value: "50" } });
  expect(addCoordinate.disabled).toBe(true);
  fireEvent.click(screen.getByRole("checkbox", { name: "我已核对坐标并接受误点风险" }));
  fireEvent.click(addCoordinate);
  expect(addCoordinate.disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "审阅并运行" }));
  await waitFor(() => expect(io.authorize).toHaveBeenCalledOnce());
  expect(io.authorize.mock.calls[0][0].steps[0].locator).toEqual({ kind: "coordinate", x: 50, y: 60, riskAccepted: true });
  expect(io.authorize.mock.calls[0][0].steps[0].action).toBe("click");
});
it("uses physical Windows coordinates and resets risk confirmation when the target changes", async () => {
  io.targets.mockResolvedValue([{ identity: "fixture", title: "Owned fixture", processId: 123 }, { identity: "second", title: "Other fixture", processId: 124 }]);
  await setup();
  fireEvent.click(screen.getByText("坐标回退（高风险）"));
  expect(screen.getByText(/屏幕物理像素/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText("坐标 X"), { target: { value: "-100" } });
  fireEvent.change(screen.getByLabelText("坐标 Y"), { target: { value: "50" } });
  let button = screen.getByRole("button", { name: "添加坐标点击" }) as HTMLButtonElement;
  fireEvent.click(screen.getByRole("checkbox", { name: "我已核对坐标并接受误点风险" }));
  expect(button.disabled).toBe(false);
  fireEvent.change(screen.getByLabelText("RPA 目标窗口"), { target: { value: "second" } });
  button = screen.getByRole("button", { name: "添加坐标点击" }) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("坐标 X"), { target: { value: "-100" } });
  fireEvent.change(screen.getByLabelText("坐标 Y"), { target: { value: "50" } });
  fireEvent.click(screen.getByRole("checkbox", { name: "我已核对坐标并接受误点风险" }));
  fireEvent.click(button);
  fireEvent.click(screen.getByRole("button", { name: "审阅并运行" }));
  await waitFor(() => expect(io.authorize).toHaveBeenCalledOnce());
  expect(io.authorize.mock.calls[0][0].target).toEqual({ kind: "windows", identity: "second" });
  expect(io.authorize.mock.calls[0][0].steps[0].locator).toEqual({ kind: "coordinate", x: -100, y: 50, riskAccepted: true });
});
it("reads saved receipts without granting or replaying execution", async () => {
  io.checkpoints.mockResolvedValue([{ checkpointId: "checkpoint-test", planId: "saved-plan", status: "failed", completedSteps: 0, totalSteps: 1, updatedAtMs: 0, resumable: false, receipts: [{ stepId: "click-once", status: "uncertain" }] }]);
  render(<RpaPanel close={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "刷新执行记录" }));
  await screen.findByText(/saved-plan/);
  expect(screen.getByText(/结果待核对，请勿重复执行/)).toBeTruthy();
  expect(io.authorize).not.toHaveBeenCalled();
  expect(io.step).not.toHaveBeenCalled();
  io.checkpoints.mockRejectedValueOnce("BLK-RPA-JOURNAL-001");
  fireEvent.click(screen.getByRole("button", { name: "刷新执行记录" }));
  await screen.findByText("BLK-RPA-JOURNAL-001");
  expect(screen.queryByText(/saved-plan/)).toBeNull();
});
it("requires recovery conditions and starts after the completed effect", async () => {
  const record = { checkpointId: "checkpoint-test", revision: 3, planId: "saved-plan", status: "stopped", completedSteps: 1, totalSteps: 2, updatedAtMs: 0, resumable: true, receipts: [{ stepId: "done", status: "completed" }] };
  const plan = { schemaVersion: "blocky.rpa/v1", planId: "saved-plan", target: { kind: "windows", identity: "fixture" }, steps: [
    { stepId: "done", action: "click", locator: { kind: "uia", automationId: "button" }, effectKey: "once", timeoutMs: 5000 },
    { stepId: "pending", action: "read", locator: { kind: "uia", automationId: "result" }, timeoutMs: 5000 },
  ] };
  io.checkpoints.mockResolvedValue([record]); io.recoveryPreview.mockResolvedValue({ checkpoint: record, plan });
  io.recover.mockResolvedValue({ sessionId: "new-grant" });
  io.status.mockResolvedValueOnce({ status: "ready", nextStep: "pending", active: false, receipts: record.receipts }).mockResolvedValue({ status: "completed", active: false, receipts: record.receipts });
  render(<RpaPanel close={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "刷新执行记录" }));
  fireEvent.click(await screen.findByRole("button", { name: "准备恢复" }));
  fireEvent.click(await screen.findByRole("button", { name: "核对并申请恢复" }));
  await screen.findByText("请为每个已完成操作填写有效的状态核对条件。");
  expect(io.recover).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("恢复控件 done"), { target: { value: "confirmed-result" } });
  fireEvent.click(screen.getByRole("button", { name: "核对并申请恢复" }));
  await waitFor(() => expect(screen.getByRole("status").textContent).toBe("已完成"));
  expect(io.recover.mock.calls[0][0]).toEqual(plan);
  expect(io.recover.mock.calls[0][1].checks[0].locator).toEqual({ kind: "uia", automationId: "confirmed-result" });
  expect(io.authorize).not.toHaveBeenCalled();
  expect(io.step.mock.calls.map((args) => args[1])).toEqual(["pending"]);
});
afterEach(() => { cleanup(); vi.resetAllMocks(); });
it("masks sensitive manual input and keeps its value outside the reviewed plan", async () => {
  await setup(); add("fill", "Password");
  const input = screen.getByLabelText(/^填写内容 /) as HTMLInputElement;
  expect(input.type).toBe("password");
  fireEvent.click(screen.getByRole("checkbox", { name: /敏感输入/ }));
  fireEvent.change(input, { target: { value: "PRIVATE_SENSITIVE_CANARY" } });
  fireEvent.click(screen.getByRole("button", { name: "审阅并运行" }));
  await waitFor(() => expect(io.step).toHaveBeenCalledOnce());
  const reviewed = io.authorize.mock.calls[0][0];
  expect(reviewed.steps[0].value).toEqual({ kind: "manual-input", sensitive: true });
  expect(JSON.stringify(reviewed)).not.toContain("PRIVATE_SENSITIVE_CANARY");
  expect(io.step.mock.calls[0][2]).toBe("PRIVATE_SENSITIVE_CANARY");
});
it("binds browser runs to this project and origin and closes the preceding session", async () => {
  render(<RpaPanel projectId="project-browser" close={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("目标类型"),{target:{value:"browser"}});
  fireEvent.change(screen.getByLabelText("起始网址"),{target:{value:"https://example.test/form"}});
  fireEvent.change(screen.getByLabelText("控件角色"),{target:{value:"textbox"}});
  add("read","Answer");
  fireEvent.click(screen.getByRole("button",{name:"审阅并运行"}));
  await waitFor(()=>expect(screen.getByRole("status").textContent).toBe("已完成"));
  expect(io.authorize.mock.calls[0][0].target).toEqual({kind:"browser",identity:"https://example.test"});
  expect(io.authorize.mock.calls[0][0].steps[0].locator).toEqual({kind:"browser",role:"textbox",name:"Answer"});
  expect(io.authorize.mock.calls[0][2]).toEqual({projectId:"project-browser",url:"https://example.test/form"});
  fireEvent.click(screen.getByRole("button",{name:"审阅并运行"}));
  await waitFor(()=>expect(io.authorize).toHaveBeenCalledTimes(2));
  expect(io.stop).toHaveBeenCalledWith("session");
});
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
it("passes only the reviewed plan to ghost-block creation, without the typed runtime input",async()=>{
  const draft=vi.fn(async()=>{});
  render(<RpaPanel draft={draft} close={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("目标类型"),{target:{value:"browser"}});
  fireEvent.change(screen.getByLabelText("起始网址"),{target:{value:"https://example.test/form"}});
  fireEvent.change(screen.getByLabelText("控件角色"),{target:{value:"textbox"}});
  add("fill","Answer");
  fireEvent.change(screen.getByLabelText(/^填写内容 /),{target:{value:"PRIVATE_TYPED_VALUE"}});
  fireEvent.click(screen.getByRole("button",{name:"转为积木草案"}));
  await waitFor(()=>expect(draft).toHaveBeenCalledOnce());
  expect(JSON.stringify(draft.mock.calls)).not.toContain("PRIVATE_TYPED_VALUE");
  expect(io.authorize).not.toHaveBeenCalled();
});
