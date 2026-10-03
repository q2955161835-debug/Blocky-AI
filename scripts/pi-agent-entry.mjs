import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const entryPattern = /[\\/]@earendil-works[\\/]pi-agent-core[\\/]dist[\\/]index\.js$/;
/** Use the audited public Agent export without initializing unused Harness/Shell exports. */
export async function piAgentEntry(path) {
  if (!entryPattern.test(path)) return undefined;
  const pkg=JSON.parse(await readFile(resolve(dirname(path),"../package.json"),"utf8"));
  const source=await readFile(path,"utf8");
  if(pkg.version!=="0.86.0" || !source.includes('"./agent.js"')) throw Error("Pi entry audit requires the locked Agent export");
  return {contents:'export { Agent } from "./agent.js";',resolveDir:dirname(path),loader:"js"};
}
export const piAgentOnlyPlugin=()=>({name:"pi-agent-only",setup(builder){builder.onLoad({filter:entryPattern},piAgentEntryLoad);}});
async function piAgentEntryLoad(args) { return piAgentEntry(args.path); }
