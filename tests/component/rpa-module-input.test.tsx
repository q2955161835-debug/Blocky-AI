// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useRpaInput } from "../../apps/studio-desktop/src/composition/useRpaInput";
import { RpaInputDialog } from "../../apps/studio-desktop/src/app/RpaInputDialog";
import { studioRpaModules } from "../../apps/studio-desktop/src/composition/rpaModules";
const io=vi.hoisted(()=>({authorize:vi.fn(),cancelAuthorization:vi.fn(async()=>{}),stop:vi.fn(async()=>{}),status:vi.fn()}));
vi.mock("../../apps/studio-desktop/src/composition/rpa",()=>({rpaNative:io}));
afterEach(()=>{cleanup();vi.clearAllMocks();});
it("collects manual input only for the pending step and removes it on cancellation",async()=>{
  const result=vi.fn(),abort=new AbortController();
  function Harness(){const input=useRpaInput();return <><button onClick={()=>void input.request({moduleId:"main",blockId:"fill"},abort.signal).then(result,e=>result(e.message))}>request</button>{input.source&&<RpaInputDialog accept={input.answer} stop={()=>abort.abort()} />}</>;}
  render(<Harness/>);fireEvent.click(screen.getByText("request"));
  fireEvent.change(screen.getByLabelText("填写内容"),{target:{value:"PRIVATE_TEXT"}});
  expect((screen.getByLabelText("填写内容") as HTMLInputElement).type).toBe("password");
  fireEvent.click(screen.getByRole("button",{name:"停止运行"}));
  await waitFor(()=>expect(result).toHaveBeenCalledWith("BLK-RPA-CANCELLED"));
  expect(screen.queryByLabelText("填写内容")).toBeNull();
});
it("closes a grant returned after authorization cancellation and never exposes it to the runtime",async()=>{
  let grant!:(value:{sessionId:string})=>void;
  io.authorize.mockImplementation(()=>new Promise(resolve=>{grant=resolve;}));
  const abort=new AbortController();
  const ports=studioRpaModules(async()=>"");
  const pending=ports.open({plan:{schemaVersion:"blocky.rpa/v1",planId:"owned",target:{kind:"windows",identity:"owned"},steps:[]},inputSources:{}},abort.signal);
  abort.abort();grant({sessionId:"late"});
  await expect(pending).rejects.toThrow();expect(io.stop).toHaveBeenCalledWith("late");expect(io.status).not.toHaveBeenCalled();
});
