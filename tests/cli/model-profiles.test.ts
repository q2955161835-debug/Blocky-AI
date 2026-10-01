import { expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { modelResource } from "../fixtures/model-resource";
async function fixture() {
  await mkdir("try/model-providers", { recursive: true });
  const root = await mkdtemp(resolve("try/model-providers/cli-")), profile = join(root,"profile");
  const outputs: string[] = [];
  const cli = (...args:string[]) => {
    const run = spawnSync(process.execPath,[resolve("tools/blocky-cli/dist/main.mjs"), ...args,"--json"],{
      encoding:"utf8",timeout:30000,windowsHide:true,env:{...process.env,BLOCKY_PROFILE_DIR:profile,TEMP:root,TMP:root},
    });
    outputs.push(run.stdout);
    return { code:run.status,value:JSON.parse(run.stdout) };
  };
  const define = async (name:string,value:unknown) => { const file=join(root,`${name}.json`);await writeFile(file,JSON.stringify(value));return file; };
  return {root,profile,cli,define,outputs};
}
const provider = { schemaVersion:"blocky.model-provider/v1",providerId:"shared",displayName:"Shared account",adapter:"xirang",protocol:"openai-chat",revision:1,secretBindings:[{fieldId:"apiKey",secretRef:"saved-model-secret"}] };
const model = (id:string) => ({...modelResource(id),definition:{connectionRef:"shared",modelId:`model-${id}`,timeoutMs:60000,capabilities:["text","tools"],parameters:{maxOutputTokens:1024}},secretBindings:[]});
it("configures shared models across real processes and preserves existing projects and approval boundaries",async()=>{
  const f=await fixture(),{cli,define,root}=f;
  const old=join(root,"old.blocky");
  expect(cli("project","create","--template","research-companion","--output",old).code).toBe(0);
  const bytes=await readFile(old);
  expect(cli("provider","set","--definition",await define("provider",provider)).code).toBe(0);
  for(const id of ["one","two"]) expect(cli("model-profile","set","--definition",await define(id,model(id))).code).toBe(0);
  expect(cli("provider","list").value.data.providers).toHaveLength(1);
  expect(cli("model-profile","list").value.data.models.map((m:any)=>m.resourceId).sort()).toEqual(["one","two"]);
  const envFile=join(root,"fixture.env");await writeFile(envFile,"MODEL_KEY=synthetic-shared-private-value\n");
  expect(cli("secret","import","--id","saved-model-secret","--env-file",envFile,"--variable","MODEL_KEY").code).toBe(0);
  expect(cli("model-profile","default","--id","two").code).toBe(0);
  const next=join(root,"new.blocky");
  expect(cli("project","create","--template","research-companion","--output",next).code).toBe(0);
  expect(await readFile(old)).toEqual(bytes);
  const preflight=cli("builder","draft",next,"--module","research-agent","--prompt","Explain project","--live","--request-id","shared-preview","--output",join(root,"draft.json"));
  expect(preflight.code).toBe(4);
  expect(preflight.value.data.pendingApproval.modelId).toBe("model-two");
  expect(cli("builder","draft",next,"--module","research-agent","--prompt","Answer briefly","--output",join(root,"offline-draft.json")).code).toBe(0);
  const registryFile=join(f.profile,"user/resources/app.json"),before=await readFile(registryFile);
  const blocked=cli("provider","delete","--id","shared");
  expect(blocked.value.error.code).toBe("BLK-PROVIDER-IN-USE");
  expect(blocked.value.error.hint).toContain("one");expect(blocked.value.error.hint).toContain("two");
  expect(cli("model-profile","set","--definition",await define("bad",{...model("bad"),definition:{...model("bad").definition,connectionRef:"missing"}})).code).toBe(3);
  expect(await readFile(registryFile)).toEqual(before);
  expect(cli("provider","set","--definition",await define("update",{...provider,displayName:"Renamed connection"})).code).toBe(0);
  const current=cli("resource","list").value.data;
  expect(current.providers[0].revision).toBe(2);expect(current.resources.map((r:any)=>r.resourceId).sort()).toEqual(["one","two"]);
  expect(cli("provider","set","--definition",await define("stale",provider)).value.error.code).toBe("BLK-RESOURCE-CONFLICT");
  expect(cli("schema","show","blocky.model-provider/v1").code).toBe(0);
  expect(cli("schema","show","blocky.connected-model/v1").code).toBe(0);
  expect(cli("command","list","--query","model-profile").value.data.commands.length).toBe(4);
  expect(f.outputs.join("\n")).not.toContain("synthetic-shared-private-value");
},60000);
it("explicitly migrates v1 once and rolls back through the Host without merging separate accounts",async()=>{
  const {cli,profile,root}=await fixture();
  const dir=join(profile,"user/resources");await mkdir(dir,{recursive:true});
  const a=modelResource("a"),b=modelResource("b"),c={...modelResource("c"),secretBindings:[{fieldId:"apiKey",secretRef:"other-account"}]};
  const original=JSON.stringify({schemaVersion:"blocky.resource-registry/v1",resources:[a,b,c]});
  await writeFile(join(dir,"app.json"),original);
  expect(cli("model-profile","default","--id","a").code).toBe(0);
  const unpersisted=join(root,"unpersisted.blocky");
  expect(cli("project","create","--template","research-companion","--output",unpersisted).code).toBe(0);
  const offline = cli("builder","draft",unpersisted,"--module","research-agent","--prompt","Answer briefly","--output",join(root,"unpersisted-draft.json"));
  expect(offline.code, JSON.stringify(offline.value.error)).toBe(0);
  expect(JSON.parse(await readFile(join(dir,"app.json"),"utf8")).schemaVersion).toBe("blocky.resource-registry/v1");
  expect(cli("resource","migrate").code).toBe(0);
  expect(cli("resource","list").value.data.providers).toHaveLength(2);
  expect(JSON.parse(await readFile(join(dir,"app.v1-backup.json"),"utf8"))).toEqual(JSON.parse(original));
  expect(cli("resource","migrate").value.data.migrated).toBe(false);
  expect(cli("resource","rollback").code).toBe(0);
  expect(JSON.parse(await readFile(join(dir,"app.json"),"utf8"))).toEqual(JSON.parse(original));
  expect(cli("resource","rollback").code).toBe(3);
},60000);
