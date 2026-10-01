import { expect, it, vi } from "vitest";
import { ProjectMemory, memoryRequestSchema, nativeAgentServices, RuntimeServiceHost, localAdapters } from "../src";
import { AgentExecution } from "../src/agent-execution";
import { RunBudget } from "../src/budget";
import { createStarter } from "../../test-fixtures/src";
it("rejects forged managed-memory shapes and forwards only the bound project through RemoteRuntime",async()=>{
  expect(memoryRequestSchema.safeParse({schemaVersion:"blocky.memory-request/v1",requestId:"r",projectId:"p",sessionId:"s",action:"delete",key:"k"}).success).toBe(false);
  const managed=vi.fn(async()=>({entries:[],time:1}));const adapters=localAdapters();adapters.agent={memoryEntries:managed};
  const host=new RuntimeServiceHost("p",adapters),signal=new AbortController().signal;
  await expect(host.request({service:"agent.memoryEntries",input:{schemaVersion:"blocky.memory-request/v1",requestId:"r",projectId:"other",sessionId:"s",action:"search"}},signal)).rejects.toThrow();
  expect(managed).not.toHaveBeenCalled();
  expect(await host.request({service:"agent.memoryEntries",input:{schemaVersion:"blocky.memory-request/v1",requestId:"r",projectId:"p",sessionId:"s",action:"search"}},signal)).toEqual({entries:[],time:1});
  await host.close();
});
it("shares one native grant for concurrent management and revokes it at settlement",async()=>{
  let release!:(value:unknown)=>void;const gate=new Promise(r=>release=r);
  const native=vi.fn(async(operation:string)=>operation==="agent-memory-authorize"?await gate:operation==="agent-memory-manage"?{entries:[],time:1}:undefined);
  const services=nativeAgentServices(native),signal=new AbortController().signal;
  const memory=new ProjectMemory(services.memoryEntries!,"p","s");
  const a=memory.request({action:"search"},signal),b=memory.request({action:"search",query:"hello"},signal);
  expect(native.mock.calls.filter(c=>c[0]==="agent-memory-authorize")).toHaveLength(1);
  release({token:"grant"});await Promise.all([a,b]);await services.close!(signal);
  expect(native.mock.calls.filter(c=>c[0]==="agent-memory-cancel")).toHaveLength(1);
});
it("session search excludes another project/session and exposes an extract summary",async()=>{
  const project=createStarter(),budget=new RunBudget(),session=new Map<string,any>([
    [JSON.stringify([project.manifest.projectId,"s","note"]),"hello local"],
    [JSON.stringify(["other","s","note"]),"hello private"],
    [JSON.stringify([project.manifest.projectId,"other","note"]),"hello other"],
  ]);
  try {
    const state=new AgentExecution(project,"hello","r","s",budget,{},undefined,session);
    await state.execute({nodeId:"search",blockType:"core.memory.search",fields:{SCOPE:"session",QUERY:"hello",LIMIT:20},inputs:{}},async()=>{});
    expect(state.value).toEqual({entries:[{key:"note",value:"hello local",summary:'"hello local"',summaryKind:"extract"}]});
  } finally {budget.dispose();}
});
