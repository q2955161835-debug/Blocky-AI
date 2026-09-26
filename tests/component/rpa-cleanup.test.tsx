// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { RpaCheckpoints } from "../../apps/studio-desktop/src/app/RpaCheckpoints";
const io = vi.hoisted(() => ({ checkpoints: vi.fn(), deleteCheckpoint: vi.fn() }));
vi.mock("../../apps/studio-desktop/src/composition/rpa", () => ({ rpaNative: io }));
const saved = { checkpointId:"checkpoint-test", revision:6, planId:"saved-plan", status:"completed", completedSteps:2, totalSteps:2, updatedAtMs:0, resumable:false, settled:true, deletable:true, receipts:[] };
beforeEach(() => { io.checkpoints.mockResolvedValue([saved]); io.deleteCheckpoint.mockResolvedValue({ checkpointId:saved.checkpointId, revision:saved.revision, deleted:true }); });
afterEach(() => { cleanup(); vi.resetAllMocks(); });
async function open() {
  render(<RpaCheckpoints disabled={false} recover={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name:"刷新执行记录" }));
  await screen.findByText(/saved-plan/);
}
it("keeps receipts until explicit confirmation then reads the matching deletion result",async()=>{
  await open();
  fireEvent.click(screen.getByRole("button",{name:"删除记录"}));
  expect(io.deleteCheckpoint).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button",{name:"保留记录"}));
  expect(io.deleteCheckpoint).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button",{name:"删除记录"}));
  fireEvent.click(screen.getByRole("button",{name:"确认删除记录"}));
  await screen.findByText("执行记录已删除");
  expect(io.deleteCheckpoint).toHaveBeenCalledWith({schemaVersion:"blocky.rpa-checkpoint-delete/v1",checkpointId:saved.checkpointId,revision:6});
  expect(screen.queryByText(/saved-plan/)).toBeNull();
});
it("keeps a stale record after Host rejection and disables protected records",async()=>{
  io.deleteCheckpoint.mockRejectedValue("BLK-RPA-JOURNAL-003");
  await open();
  fireEvent.click(screen.getByRole("button",{name:"删除记录"}));
  fireEvent.click(screen.getByRole("button",{name:"确认删除记录"}));
  await screen.findByText(/BLK-RPA-JOURNAL-003/);
  expect(screen.getByText(/saved-plan/)).toBeTruthy();
  io.checkpoints.mockResolvedValue([{...saved,deletable:false,deleteBlockedCode:"BLK-RPA-CLEANUP-001"}]);
  fireEvent.click(screen.getByRole("button",{name:"刷新执行记录"}));
  await waitFor(()=>expect((screen.getByRole("button",{name:"删除记录"}) as HTMLButtonElement).disabled).toBe(true));
  expect(screen.getByText("保留待核对、未结算或旧格式记录。")).toBeTruthy();
});
it("does not claim retention when a deletion receipt cannot be matched",async()=>{
  io.deleteCheckpoint.mockResolvedValue({...saved,checkpointId:"checkpoint-other",deleted:true});
  await open();
  fireEvent.click(screen.getByRole("button",{name:"删除记录"}));
  fireEvent.click(screen.getByRole("button",{name:"确认删除记录"}));
  await screen.findByText(/删除结果未确认，请刷新核对/);
  expect(screen.queryByText(/记录已保留/)).toBeNull();
  io.checkpoints.mockResolvedValue([]);
  fireEvent.click(screen.getByRole("button",{name:"刷新执行记录"}));
  await screen.findByText("暂无保存的执行记录");
  expect(screen.queryByText(/saved-plan/)).toBeNull();
});
