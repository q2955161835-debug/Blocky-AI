import { describe, expect, it, vi } from "vitest";
import { AttendedRpaRun, recordingToDraft, rpaPlanSchema, type RpaAdapter, type RpaPlan, type RpaReceipt } from "../src";

const plan: RpaPlan = {
  schemaVersion: "blocky.rpa/v1", planId: "draft-1",
  target: { kind: "browser", identity: "https://example.test" },
  steps: [
    { stepId: "find-1", action: "find", locator: { kind: "browser", role: "button", name: "Send" }, timeoutMs: 5000 },
    { stepId: "click-1", action: "click", locator: { kind: "browser", role: "button", name: "Send" }, timeoutMs: 5000, effectKey: "send-1" },
  ],
};
const grant = { schemaVersion: "blocky.rpa-grant/v1", sessionId: "session-1", targetIdentity: "https://example.test", actions: ["find", "click"], expiresAt: 2000 };
function adapter(): RpaAdapter {
  return { targetIdentity: "https://example.test", verifyTarget: vi.fn(async () => true), verifyReceipt: vi.fn(async () => true), perform: vi.fn(async () => {}) };
}
describe("attended RPA boundary", () => {
  it("rejects an unapproved target/action and coordinate fallback", async () => {
    const host = adapter();
    await expect(new AttendedRpaRun().run(plan, { ...grant, targetIdentity: "https://other.test" }, host, { now: () => 1000 })).rejects.toThrow("BLK-RPA-PERM-001");
    await expect(new AttendedRpaRun().run(plan, { ...grant, actions: ["find"] }, host, { now: () => 1000 })).rejects.toThrow("BLK-RPA-PERM-001");
    const coordinate = { ...plan, steps: [{ ...plan.steps[1], locator: { kind: "coordinate", x: 10, y: 20, riskAccepted: true } }] };
    await expect(new AttendedRpaRun().run(coordinate, grant, host, { now: () => 1000 })).rejects.toThrow("BLK-RPA-PERM-001");
    expect(host.perform).not.toHaveBeenCalled();
  });
  it("verifies a completed effect before skipping it on resume", async () => {
    const host = adapter();
    const receipts = await new AttendedRpaRun().run(plan, grant, host, { now: () => 1000 });
    expect(receipts).toEqual([{ stepId: "click-1", effectKey: "send-1", targetIdentity: "https://example.test", status: "completed", verified: false }]);
    const resumed = adapter();
    await new AttendedRpaRun().run(plan, grant, resumed, { now: () => 1000, receipts });
    expect(resumed.verifyReceipt).toHaveBeenCalledOnce();
    expect(resumed.perform).toHaveBeenCalledOnce(); // read-only find, never re-click
    const uncertain = adapter();
    vi.mocked(uncertain.verifyReceipt).mockResolvedValue(false);
    await expect(new AttendedRpaRun().run(plan, grant, uncertain, { now: () => 1000, receipts })).rejects.toThrow("BLK-RPA-RECEIPT-002");
    expect(uncertain.perform).toHaveBeenCalledOnce();
  });
  it("pauses before the next step and stop prevents further effects", async () => {
    const run = new AttendedRpaRun();
    const host = adapter();
    vi.mocked(host.perform).mockImplementationOnce(async () => { run.pause(); });
    const pending = run.run(plan, grant, host, { now: () => 1000 });
    await vi.waitFor(() => expect(run.status).toBe("paused"));
    expect(host.perform).toHaveBeenCalledOnce();
    run.stop();
    await expect(pending).rejects.toThrow();
    expect(host.perform).toHaveBeenCalledOnce();
  });
  it("does not store recorded input contents and validates unique effects", () => {
    const draft = recordingToDraft([{ action: "fill", locator: { kind: "browser", role: "textbox" }, sensitive: true, value: "SECRET_TEXT" }]);
    expect(JSON.stringify(draft)).not.toContain("SECRET_TEXT");
    expect(draft.steps[0].value).toEqual({ kind: "manual-input" });
    expect(() => rpaPlanSchema.parse({ ...plan, steps: [plan.steps[1], plan.steps[1]] })).toThrow();
  });
});
