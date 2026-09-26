import { expect, it, vi } from "vitest";
import { Runtime, localAdapters } from "../src";
import { createArchitectureStarter } from "../../block-catalog/src";
import { planToRpaBlocks, type RpaModulePorts } from "@blocky/rpa-core";

function fixture() {
  const project = createArchitectureStarter("rule-engine", "owned-rpa");
  const root = planToRpaBlocks({ schemaVersion: "blocky.rpa/v1", planId: "owned", target: {kind:"windows", identity:"owned-window"}, steps: [
    {stepId:"fill",action:"fill",locator:{kind:"uia",automationId:"answer"},timeoutMs:1000,effectKey:"fill",value:{kind:"manual-input"}},
    {stepId:"read",action:"read",locator:{kind:"uia",automationId:"answer"},timeoutMs:1000},
  ]});
  project.workspaces.main.blocks.blocks = [root];
  const session = root.inputs!.HANDLER.block!, fill = session.inputs!.STEPS.block!, read = fill.next!.block;
  session.next = {block:{type:"core.output.structured",id:"output",fields:{SCHEMA:"schemas/result.json"}}};
  return {project,root,fill,read};
}
it("uses the approved Host ports, pauses at each source block, and excludes input/read bodies from events", async()=>{
  const {project,root,fill,read} = fixture(), performed: string[] = [], close=vi.fn(async()=>{});
  const ports: RpaModulePorts = {manualInput:async()=>"PRIVATE_INPUT_BODY",open:async()=>({checkpointId:"checkpoint-owned",close,perform:async(step,input)=>{
    performed.push(step.stepId); if(step.action==="fill") expect(input).toBe("PRIVATE_INPUT_BODY");
    return step.action==="read"?{text:"PRIVATE_READ_BODY"}:{};
  }})};
  const runtime = new Runtime({adapters:{...localAdapters(),rpa:ports}});
  const result = await runtime.run(project,root.id,"question",{debug:{breakpoints:[{moduleId:"main",blockId:fill.id},{moduleId:"main",blockId:read.id}]},onEvent:event=>{
    if(event.type==="run.paused") runtime.resume();
  }});
  expect(result.status).toBe("completed"); expect(result.structured).toBe("PRIVATE_READ_BODY");
  expect(performed).toEqual([fill.id,read.id]); expect(close).toHaveBeenCalledOnce();
  expect(result.events.filter(e=>e.type==="run.paused")).toHaveLength(2);
  expect(result.events.some(e=>e.type==="checkpoint.created")).toBe(true);
  expect(JSON.stringify(result.events)).not.toMatch(/PRIVATE_INPUT_BODY|PRIVATE_READ_BODY|owned-window|automationId/);
});
it("cannot execute without a Host, and cancellation waits for settlement before the run terminal",async()=>{
  const {project,root}=fixture();
  expect((await new Runtime().run(project,root.id,"x")).status).toBe("failed");
  const abort=new AbortController(); let release!:()=>void; let settled=false;
  const ports:RpaModulePorts={manualInput:async()=>"x",open:async()=>({checkpointId:"checkpoint-owned",perform:async()=>{abort.abort();throw Error("BLK-RPA-CANCELLED");},close:()=>new Promise<void>(resolve=>{release=()=>{settled=true;resolve();};})})};
  const terminal:string[]=[];
  const pending=new Runtime({adapters:{...localAdapters(),rpa:ports}}).run(project,root.id,"x",{signal:abort.signal,onEvent:event=>{if(event.type==="run.cancelled") terminal.push(event.type);}});
  await vi.waitFor(()=>expect(release).toBeTypeOf("function")); expect(terminal).toEqual([]);
  release(); expect((await pending).status).toBe("cancelled");expect(settled).toBe(true);expect(terminal).toHaveLength(1);
});
it("returns a bound capture reference and refuses an image from another checkpoint",async()=>{
  const {project,root}=fixture();const session=root.inputs!.HANDLER.block!;
  project.schemas["schemas/result.json"]={type:"object"};
  session.inputs!.STEPS.block={id:"shot",type:"core.computer.capture",fields:{LOCATOR:{kind:"uia",automationId:"panel"},TIMEOUT_MS:"1000"}};
  const capture={schemaVersion:"blocky.rpa-capture/v1"as const,captureId:"capture-11111111-1111-1111-1111-111111111111",checkpointId:"checkpoint-owned",planId:"owned",stepId:"shot",createdAt:1000,expiresAt:86401000,width:2,height:1,bytes:80,sha256:"a".repeat(64),maskedRegions:1};
  const close=vi.fn(async()=>{});
  const ports:RpaModulePorts={open:async()=>({checkpointId:"checkpoint-owned",close,perform:async()=>({capture})})};
  const runtime=new Runtime({adapters:{...localAdapters(),rpa:ports}});
  const result=await runtime.run(project,root.id,"x");
  expect(result.status,JSON.stringify(result)).toBe("completed");expect(result.structured).toEqual(capture);
  expect(JSON.stringify(result.events)).not.toMatch(/data:image|base64/);
  capture.checkpointId="checkpoint-other";
  expect((await runtime.run(project,root.id,"x")).status).toBe("failed");expect(close).toHaveBeenCalledTimes(2);
});
