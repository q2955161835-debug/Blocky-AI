import { afterAll, beforeAll, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve, join } from "node:path";
const base=resolve("try/agent-capability-upgrade/memory-cli-tests");
let directory:string;
beforeAll(()=>{mkdirSync(base,{recursive:true});directory=mkdtempSync(join(base,"case-"));});
afterAll(()=>{if(directory&&directory.startsWith(base+"\\"))rmSync(directory,{recursive:true,force:true});});
function cli(...args:string[]) {
  const child=spawnSync(process.execPath,[resolve("tools/blocky-cli/dist/main.mjs"),...args],{encoding:"utf8",windowsHide:true,timeout:20000,env:{...process.env,BLOCKY_PROFILE_DIR:join(directory,"profile")}});
  return {code:child.status,reply:JSON.parse(child.stdout)};
}
let counter=0;
function execute(action:string,fields:Record<string,unknown>={}) {
  const file=join(directory,"request.json");writeFileSync(file,JSON.stringify({schemaVersion:"blocky.memory-request/v1",requestId:`request-${++counter}`,projectId:"project-one",sessionId:"session-one",action,...fields}));
  const pre=cli("memory","preflight","--request",file,"--json");expect(pre.code).toBe(0);
  return cli("memory","execute","--request",file,"--approve",pre.reply.data.requestDigest,"--json");
}
it("manages CAS memory through separate CLI processes and never returns revoked entries",()=>{
  expect(cli("schema","show","blocky.memory-request/v1","--json").code).toBe(0);
  expect(execute("upsert",{key:"note",value:"public classroom note",sourceRef:"classroom",expectedVersion:0,conflictPolicy:"reject",ttlSeconds:3600}).reply.data.entry.version).toBe(1);
  expect(execute("read",{key:"note"}).reply.data).toMatchObject({found:true,version:1,entry:{value:"public classroom note",summaryKind:"extract"}});
  const conflict=execute("upsert",{key:"note",value:"wrong stale write",expectedVersion:0,conflictPolicy:"replace"});expect(conflict.code).toBe(3);expect(conflict.reply.error.code).toBe("BLK-MEMORY-CONFLICT");
  expect(execute("search",{query:"classroom"}).reply.data.entries).toHaveLength(1);
  expect(execute("revoke-source",{sourceRef:"classroom"}).code).toBe(0);
  expect(execute("search",{query:"classroom"}).reply.data.entries).toEqual([]);
  expect(execute("allow-source",{sourceRef:"classroom"}).code).toBe(0);
  expect(execute("read",{key:"note"}).reply.data).toMatchObject({found:false,version:2});
});
