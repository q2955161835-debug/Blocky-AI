import { expect, it } from "vitest";
import { Runtime } from "../src/runtime";
import { localAdapters } from "../src/adapters";
import { createStartingBlueprint } from "../../block-catalog/src/starting-blueprints";
import { createAgentExample } from "../../test-fixtures/src/scenarios";
import type { Generation, GenerationRequest } from "../src/agent-context";
import type { Project } from "@blocky/language-schema";

const reply = (text: string, toolCalls: Generation["toolCalls"] = []): Generation => ({ text, toolCalls, finishReason: toolCalls.length ? "tool_calls" : "stop", provider: "unit-fixture", transport: "local", model: "unit-model", requestId: "unit-model-response", usage: null });
function configured(id: string): Project {
  const project=createStartingBlueprint(id),fixture=createAgentExample("fixture");
  project.resources["assistant-model"]={...fixture.resources["agent-model"],resourceId:"assistant-model"};
  project.resources["assistant-model"].definition.capabilities=["text","tools"];
  project.manifest.resources.push({resourceId:"assistant-model",kind:"model",scope:"project",definitionRef:"resources/assistant-model.json",secretRefs:[]});
  return project;
}
it("runs an editable work blueprint through SDK -> tool -> next model without consuming its entire output budget first",async()=>{
  const requests: GenerationRequest[]=[]; let calls=0;
  const adapters=localAdapters(); adapters.agent={generate:async(request)=>{requests.push(request);return requests.length===1?reply("",[{id:"read-list",name:"tool_1",arguments:{input:{}}}]):reply("task completed");},tool:async(request)=>{calls++;expect(request.resource.definition.operation).toBe("list");return{entries:["report.txt"]};}};
  const runtime=new Runtime({adapters}); const project=configured("work-assistant");
  const result=await runtime.run(project,"assistant-chat-trigger","inspect files",{moduleId:"main"});
  expect(result.status,JSON.stringify(result.events)).toBe("completed"); expect(calls).toBe(1);expect(requests.length).toBe(2);
  expect(JSON.parse(requests[1].messages.at(-1)!.content)).toEqual({entries:["report.txt"]});
  expect(result.events.some((event)=>event.data.engine==="pi-agent-core/0.86.0")).toBe(true);
});
it("keeps conversation across a restored session, isolates projects and discards history when role changes",async()=>{
  const requests: GenerationRequest[]=[];const adapters=localAdapters();adapters.agent={generate:async(request)=>{requests.push(request);return reply(`reply ${requests.length}`);}};
  const project=configured("pi-agent"), runtime=new Runtime({adapters});
  expect((await runtime.run(project,"assistant-chat-trigger","first subject",{moduleId:"main"})).status).toBe("completed");
  const restored=new Runtime({adapters,sessionState:runtime.captureSession()});
  expect((await restored.run(project,"assistant-chat-trigger","second subject",{moduleId:"main"})).status).toBe("completed");
  expect(requests[1].messages.some((m)=>m.content==="first subject")).toBe(true);
  expect(requests[1].messages.some((m)=>m.content==="reply 1")).toBe(true);
  const other=configured("pi-agent");await restored.run(other,"assistant-chat-trigger","other project",{moduleId:"main"});
  expect(requests[2].messages.some((m)=>m.content==="first subject")).toBe(false);
  project.workspaces.main.blocks.blocks[0].fields!.ROLE="changed specialty";
  await restored.run(project,"assistant-chat-trigger","new role",{moduleId:"main"});
  expect(requests[3].messages.some((m)=>m.content==="first subject")).toBe(false);
  const fresh=new Runtime({adapters});await fresh.run(project,"assistant-chat-trigger","fresh session",{moduleId:"main"});
  expect(requests[4].messages.some((m)=>m.content==="new role")).toBe(false);
});
