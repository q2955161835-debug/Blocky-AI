import { afterEach, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
const mock=vi.hoisted(()=>({spawn:vi.fn()}));
vi.mock("node:child_process",()=>({spawn:mock.spawn}));
vi.mock("node:fs",()=>({existsSync:()=>true}));
vi.mock("../../tools/blocky-cli/src/native-store",()=>({helper:"owned-helper"}));
import { cliRpaModules } from "../../tools/blocky-cli/src/rpa-module";
class Pipe extends EventEmitter {destroyed=false;setEncoding(){}resume(){}write=vi.fn();destroy(){this.destroyed=true;}}
afterEach(()=>{vi.useRealTimers();vi.clearAllMocks();});
it("returns an explicit settlement failure when termination fails and close never arrives",async()=>{
  vi.useFakeTimers();
  const child=Object.assign(new EventEmitter(),{stdin:new Pipe(),stdout:new Pipe(),stderr:new Pipe(),kill:vi.fn(()=>false),unref:vi.fn()});
  mock.spawn.mockReturnValue(child);
  const opening=cliRpaModules({}).open({plan:{schemaVersion:"blocky.rpa/v1",planId:"owned",target:{kind:"windows",identity:"owned"},steps:[]},inputSources:{}},new AbortController().signal);
  child.stdout.emit("data",JSON.stringify({schemaVersion:"blocky.rpa-module-session/v1",type:"ready",requestId:0,value:{checkpointId:"checkpoint-owned"}})+"\n");
  const handle=await opening;
  const closing=expect(handle.close()).rejects.toThrow("BLK-RPA-SETTLEMENT-001");
  await vi.advanceTimersByTimeAsync(7500);await closing;
  expect(child.kill).toHaveBeenCalledOnce();expect(child.unref).toHaveBeenCalledOnce();expect(child.stdin.destroyed).toBe(true);
});
