import { startingBlueprints } from "@blocky/block-catalog";
import { inspectRunSetup } from "@blocky/runtime-core";
import { type Args, allow, required } from "./arguments";
import { envelope, CliError } from "./protocol";
import { readProject, nativeUserOperation, workspaceTransport } from "./native-store";
import { userRegistryMap } from "./user-config";

export const startingBlueprintHelp = [
  "template list --json",
  "template show <knowledge-assistant|work-assistant|coding-assistant|pi-agent> --json",
  "template status <file.blocky> [--workspace-dir <directory>] --json",
];
export async function startingBlueprintCommand(args: Args, signal: AbortSignal) {
  if (args.words[0] !== "template") return;
  const command = `template.${args.words[1]}`;
  if (command === "template.list") { allow(args,["json"],2); return { code:0,result:envelope(command,{templates:startingBlueprints.map(({id,displayName})=>({id,displayName}))}) }; }
  if (command === "template.show") {
    allow(args,["json"],3);
    const blueprint=startingBlueprints.find((entry)=>entry.id===args.words[2]);
    if (!blueprint) throw new CliError(3,"BLK-STARTING-BLUEPRINT-001","起始蓝图不存在。","使用 template list 查看四个可用起点。");
    return {code:0,result:envelope(command,{id:blueprint.id,displayName:blueprint.displayName,project:blueprint.create(),editable:true})};
  }
  if (command === "template.status") {
    allow(args,["json","workspace-dir"],3);
    const project=await readProject(args.words[2]),registry=await userRegistryMap();
    if (args.options.has("workspace-dir")) await workspaceTransport.bind(project.manifest.projectId,required(args,"workspace-dir"),signal);
    const status = await workspaceTransport.status(project.manifest.projectId) as {available:boolean};
    const setup=await inspectRunSetup(project,{registry,workspaceAvailable:status.available,knowledgeCall:nativeUserOperation});
    return {code:0,result:envelope(command,{projectId:project.manifest.projectId,...setup,modelApiCalled:false})};
  }
  throw new CliError(2,"BLK-CLI-002","未知起始蓝图命令。");
}
