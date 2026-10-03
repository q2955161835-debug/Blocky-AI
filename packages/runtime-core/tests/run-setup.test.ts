import { expect, it } from "vitest";
import { inspectRunSetup } from "../src/run-setup";
import { createStartingBlueprint } from "../../block-catalog/src/starting-blueprints";
import { createAgentExample } from "../../test-fixtures/src/scenarios";
import { knowledgePort, synchronize, type KnowledgeCall } from "@blocky/knowledge-core";
import type { Project } from "@blocky/language-schema";

function configure(project: Project) {
  project.resources["assistant-model"]={...createAgentExample().resources["agent-model"],resourceId:"assistant-model"};
  project.resources["assistant-model"].definition.capabilities=["text","tools"];
  project.manifest.resources.push({resourceId:"assistant-model",kind:"model",scope:"project",definitionRef:"resources/assistant-model.json",secretRefs:[]});
  return project;
}
it("distinguishes a missing model, missing file scope and missing tool from generic failure",async()=>{
  const project=createStartingBlueprint("work-assistant");
  let setup=await inspectRunSetup(project);
  expect(setup.ready).toBe(false);expect(setup.issues.map(i=>i.kind)).toEqual(["model","workspace"]);
  configure(project);setup=await inspectRunSetup(project,{workspaceAvailable:true});
  expect(setup.ready).toBe(true);
  delete project.resources[Object.values(project.resources).find(r=>r.kind==="tool"&&r.definition.operation==="list")!.resourceId];
  setup=await inspectRunSetup(project,{workspaceAvailable:true});
  expect(setup.ready).toBe(false);expect(setup.issues.some(i=>i.kind==="project"&&i.code==="BLK-RESOURCE-001")).toBe(true);
  project.manifest.resources=project.manifest.resources.filter(r=>r.resourceId!=="workspace-list");
  setup=await inspectRunSetup(project,{workspaceAvailable:true});
  expect(setup.ready).toBe(false);expect(setup.issues.some(i=>i.kind==="project"&&i.code==="BLK-RESOURCE-001")).toBe(true);
});
it("projects source/index readiness from the shared ingestion protocol, including revocation",async()=>{
  const project=configure(createStartingBlueprint("knowledge-assistant"));
  let value: unknown=null, revision=0,generation=1,added=false,readable=true;
  const call: KnowledgeCall=async(op,fields)=>{
    expect(fields.projectId).toBe(project.manifest.projectId);
    if(op==="knowledge-sources")return{generation,sources:added?[{sourceId:"manual",kind:"file",title:"manual.txt",revision:"v1",readable,allowedPrincipals:readable?["local-user"]:[],metadata:{}}]:[]};
    if(op==="knowledge-load-index")return{revision,generation,value};
    if(op==="knowledge-read-source")return{sourceId:"manual",generation,revision:"v1",nextCursor:null,excluded:[],documents:[{documentId:"manual-doc",title:"manual",format:"text",text:"Keep weekly reports in the reports folder.",revision:"v1",locator:{path:"manual.txt",lineStart:1,lineEnd:1},metadata:{}}]};
    if(op==="knowledge-save-index"){expect(fields.expectedRevision).toBe(revision);value=structuredClone(fields.value);return{revision:++revision,generation};}
    throw Error(op);
  };
  const check=()=>inspectRunSetup(project,{knowledgeCall:call});
  expect((await check()).knowledge[0].state).toBe("empty");
  added=true;expect((await check()).knowledge[0].state).toBe("not-synchronized");
  await synchronize(knowledgePort(call,project.manifest.projectId,String(project.resources["assistant-knowledge"].definition.collection)));
  const synced=await check();expect(synced.ready).toBe(true);expect(synced.knowledge[0].chunks).toBeGreaterThan(0);
  generation++;expect((await check()).knowledge[0].state).toBe("stale");
  readable=false;expect((await check()).issues).toMatchObject([{kind:"knowledge",code:"BLK-KNOWLEDGE-ACCESS"}]);
});
