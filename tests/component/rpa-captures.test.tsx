// @vitest-environment jsdom
import { expect,it,vi,afterEach } from "vitest";
import { render,screen,fireEvent,waitFor,cleanup } from "@testing-library/react";
import { RpaCaptures } from "../../apps/studio-desktop/src/app/RpaCaptures";
import { rpaNative } from "../../apps/studio-desktop/src/composition/rpa";
vi.mock("../../apps/studio-desktop/src/composition/rpa",()=>({rpaNative:{captures:vi.fn(),captureRead:vi.fn(),captureDelete:vi.fn(),captureExport:vi.fn()}}));
afterEach(()=>{cleanup();vi.clearAllMocks();});
it("requires explicit view, removes deleted images and reports export refusal",async()=>{
  vi.mocked(rpaNative.captures).mockResolvedValue([{schemaVersion:"blocky.rpa-capture/v1",captureId:"capture-11111111-1111-1111-1111-111111111111",checkpointId:"checkpoint-test",planId:"test",stepId:"shot",createdAt:Date.now(),expiresAt:Date.now()+86400000,width:2,height:1,bytes:72,sha256:"a".repeat(64),maskedRegions:1}]);
  vi.mocked(rpaNative.captureRead).mockResolvedValue({capture:(await rpaNative.captures())[0],dataUrl:"data:image/png;base64,AAAA"});
  vi.mocked(rpaNative.captureDelete).mockResolvedValue({deleted:true});
  vi.mocked(rpaNative.captureExport).mockRejectedValue(Error("BLK-RPA-CAPTURE-006"));
  render(<RpaCaptures/>);
  fireEvent.click(screen.getByText("刷新截图记录"));await screen.findByText("查看截图");
  expect(rpaNative.captureRead).not.toHaveBeenCalled();expect(screen.queryByRole("img")).toBeNull();
  fireEvent.click(screen.getByText("查看截图"));await screen.findByRole("img");
  await waitFor(()=>expect((screen.getByText("导出截图")as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByText("导出截图"));await screen.findByText(/目标文件已存在/);
  fireEvent.click(screen.getByText("删除截图"));await screen.findByText("截图已删除");
  expect(screen.queryByRole("img")).toBeNull();expect(screen.queryByText("查看截图")).toBeNull();
});
