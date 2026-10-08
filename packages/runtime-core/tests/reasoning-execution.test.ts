import {expect,it} from "vitest";
import {Runtime,RemoteRuntime,RuntimeServiceHost,localAdapters,type GenerationRequest} from "../src";
import {modelResource} from "../../../tests/fixtures/model-resource";
import {createAgentExample} from "../../test-fixtures/src/scenarios";
function projectFixture(id:string) {const p=createAgentExample(id);const model=modelResource("agent-model");delete p.resources["agent-model"];p.manifest.resources[0]={resourceId:model.resourceId,kind:"model",scope:"user",definitionRef:model.resourceId,secretRefs:["saved-model-secret"]};return {project:p,userRegistry:new Map([[model.resourceId,model]])};}
function ports(requests:GenerationRequest[]) {
 const adapters=localAdapters();adapters.agent={generate:async request=>{requests.push(structuredClone(request));return {text:"answer",provider:"fixture",transport:"local",model:"fixture",requestId:request.requestId,usage:null};},tool:async()=>({words:2,characters:9,lines:1})};return adapters;
}
it("sets effort before a single compose call and does not leak it into a following legacy run",async()=>{
 const requests:GenerationRequest[]=[],{project,userRegistry}=projectFixture("compose-effort"),before=structuredClone(project),runtime=new Runtime({adapters:ports(requests)});
 const first=await runtime.run(project,"on-question","two words",{reasoningEffort:"low",userRegistry});expect(first.status,JSON.stringify(first.events)).toBe("completed");
 expect(requests[0].reasoningEffort).toBe("low");
 expect((await runtime.run(project,"on-question","legacy request",{userRegistry})).status).toBe("completed");
 expect(requests[1].reasoningEffort).toBeUndefined();expect(project).toEqual(before);
 await expect(runtime.run(project,"on-question","invalid",{reasoningEffort:"fake" as any})).rejects.toThrow("BLK-RUN-STATE");
});
it("carries effort through the private desktop worker protocol and rejects invalid options",async()=>{
 const requests:GenerationRequest[]=[],{project,userRegistry}=projectFixture("remote-effort"),host=new RuntimeServiceHost(project.manifest.projectId,ports(requests));
 const remote=new RemoteRuntime((v,s)=>host.request(v,s));const envelope={schemaVersion:"blocky.desktop-run/v1",project,interactionId:"on-question",question:"two words",options:{reasoningEffort:"high",userRegistry:[...userRegistry.values()]}};
 try {expect((await remote.run(envelope,new AbortController().signal,()=>{})).result.status).toBe("completed");expect(requests[0].reasoningEffort).toBe("high");await expect(remote.run({...envelope,options:{reasoningEffort:"fake"}},new AbortController().signal,()=>{})).rejects.toThrow("BLK-RUN-STATE");}finally{await host.close();}
});
