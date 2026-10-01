// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryPanel } from "../../apps/studio-desktop/src/app/MemoryPanel";
const mocks=vi.hoisted(()=>({memory:vi.fn(),close:vi.fn(async()=>{})}));
vi.mock("../../apps/studio-desktop/src/composition/agent",()=>({studioAgentServices:()=>({memoryEntries:mocks.memory,close:mocks.close})}));
afterEach(()=>{cleanup();vi.clearAllMocks();});
it("reads the current version and submits a CAS update with retention and source",async()=>{
  mocks.memory.mockImplementation(async(request)=>request.action==="read"?{found:true,version:4,entry:{version:4,value:{lang:"zh"},sourceRef:"notes",summary:"excerpt",summaryKind:"extract",updatedAt:1,expiresAt:null}}:{ok:true,entry:{version:5,value:{lang:"zh"},sourceRef:"notes",summary:"excerpt",summaryKind:"extract",updatedAt:1,expiresAt:null}});
  render(<MemoryPanel projectId="project-one" retentionDays={2}/>);
  fireEvent.change(screen.getByLabelText("记忆标识"),{target:{value:"prefs"}});
  fireEvent.click(screen.getByText("读取当前版本"));await screen.findByText("当前版本：4");
  fireEvent.change(screen.getByLabelText("记忆冲突策略"),{target:{value:"replace"}});
  fireEvent.click(screen.getByText("保存记忆"));await screen.findByText("当前版本：5");
  expect(mocks.memory.mock.calls.at(-1)![0]).toMatchObject({projectId:"project-one",action:"upsert",key:"prefs",expectedVersion:4,conflictPolicy:"replace",sourceRef:"notes",ttlSeconds:172800,value:{lang:"zh"}});
  expect(mocks.close).toHaveBeenCalledTimes(2);
});
it("does not display a late search after project switch",async()=>{
  let done!:(v:any)=>void;mocks.memory.mockImplementation(()=>new Promise(r=>done=r));
  const view=render(<MemoryPanel key="one" projectId="project-one"/>);fireEvent.click(screen.getByText("搜索记忆"));
  view.rerender(<MemoryPanel key="two" projectId="project-two"/>);
  done({entries:[{key:"private-note",entry:{version:1,value:"private",sourceRef:null,summary:"private old project",summaryKind:"extract",updatedAt:1,expiresAt:null}}],time:1});
  await waitFor(()=>expect(mocks.close).toHaveBeenCalled());expect(screen.queryByText("private-note")).toBeNull();
});
