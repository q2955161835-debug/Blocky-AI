import { compileProject, walkNodes } from "@blocky/compiler";
import { implementationKey, resolveResource } from "@blocky/resource-registry";
import { knowledgePort, readKnowledgeState, type KnowledgeCall } from "@blocky/knowledge-core";
import type { Project, Resource } from "@blocky/language-schema";

export type SetupIssue = { kind: "model" | "knowledge" | "workspace" | "project"; code: string; message: string; resourceId?: string; moduleId?: string; blockId?: string };
/** Shared client readiness projection. Grants and source/index facts still come from Host. */
export async function inspectRunSetup(project: Project, options: { registry?: Map<string, Resource>; workspaceAvailable?: boolean; knowledgeCall?: KnowledgeCall } = {}) {
  let compiled: Awaited<ReturnType<typeof compileProject>>;
  try { compiled=await compileProject(project, options.registry); }
  catch (error) {
    const code=error instanceof Error?error.message.match(/^BLK-[A-Z0-9-]+(?=:|$)/)?.[0]:undefined;
    return {ready:false,issues:[{kind:"project" as const,code:code??"BLK-PROJECT-001",message:"项目结构或资源引用无效，请查看项目问题并修复。"}],needsWorkspace:false,knowledge:[] as {resourceId:string;state:string;sources:number;readableSources:number;chunks:number}[]};
  }
  const issues: SetupIssue[] = [], inspected = new Set<string>();
  const add = (issue: SetupIssue) => { const key = JSON.stringify([issue.kind,issue.resourceId,issue.code]); if (!inspected.has(key)) { inspected.add(key); issues.push(issue); } };
  let needsWorkspace = false;
  const knowledge: { resourceId: string; state: string; sources: number; readableSources: number; chunks: number }[] = [];
  const stages = new Set(compiled.modules.flatMap((module) => [...walkNodes(module.roots)].filter(({node})=>node.blockType==="core.knowledge.sync").map(({node})=>String(node.fields.RESOURCE))));
  for (const module of compiled.modules) for (const { node } of walkNodes(module.roots)) {
    const modelField = node.blockType === "core.knowledge.correct" ? "MODEL" : ["core.model.compose","core.reason.tool_loop"].includes(node.blockType) ? "RESOURCE" : undefined;
    if (modelField) {
      const resourceId=String(node.fields[modelField]);
      try { resolveResource(project,resourceId,"model",options.registry); }
      catch { add({kind:"model",resourceId,code:"BLK-MODEL-001",message:"选择并配置一个可用模型。",moduleId:module.moduleId,blockId:node.nodeId}); }
    }
    if (node.blockType === "core.tool.expose" || node.blockType === "core.tool.call") {
      try { const resource=resolveResource(project,String(node.fields.RESOURCE),"tool",options.registry); if (implementationKey(resource.definition.implementationRef)==="adapter://workspace-file-v1") needsWorkspace=true; } catch { /* compiler already reports invalid tool references */ }
    }
    if (node.blockType !== "core.knowledge.retrieve" || !options.knowledgeCall) continue;
    const resourceId=String(node.fields.RESOURCE);
    if (knowledge.some((item)=>item.resourceId===resourceId)) continue;
    try {
      const resource=resolveResource(project,resourceId,"knowledge",options.registry);
      if (implementationKey(resource.definition.implementationRef)!=="adapter://knowledge-local-v1") continue;
      const port=knowledgePort(options.knowledgeCall,project.manifest.projectId,String(resource.definition.collection));
      const [sources,stored]=await Promise.all([port.sources(),port.load()]);
      const state=readKnowledgeState(stored.value), readable=sources.sources.filter((source)=>source.readable);
      const status=!sources.sources.length ? "empty" : !readable.length ? "access-denied" : !state.index ? "not-synchronized" : state.pending || state.index.generation!==sources.generation ? "stale" : "ready";
      knowledge.push({resourceId,state:status,sources:sources.sources.length,readableSources:readable.length,chunks:state.index?.chunks.length??0});
      if (status!=="ready" && !stages.has(resourceId)) add({kind:"knowledge",resourceId,code:status==="access-denied"?"BLK-KNOWLEDGE-ACCESS":status==="stale"?"BLK-KNOWLEDGE-STALE":"BLK-KNOWLEDGE-NO-INDEX",message:status==="empty"?"添加资料来源，然后同步资料。":status==="access-denied"?"资料来源已撤权，请检查来源访问设置。":"资料尚未同步或已发生变化，请同步后再提问。"});
    } catch (error) { add({kind:"knowledge",resourceId,code:error instanceof Error&&/^BLK-[A-Z0-9-]+$/.test(error.message)?error.message:"BLK-KNOWLEDGE-STORE",message:"无法读取资料配置，请查看资料来源和同步状态。"}); }
  }
  if (needsWorkspace && !options.workspaceAvailable) add({kind:"workspace",code:"BLK-CODING-WORKSPACE",message:"选择工作目录，文件工具将在该目录内执行。"});
  if (compiled.diagnostics.some((d)=>d.code==="BLK-MODEL-TOOLS")) add({kind:"model",code:"BLK-MODEL-TOOLS",message:"当前模型未声明工具调用能力，请更换支持工具调用的模型或调整积木。"});
  for (const diagnostic of compiled.diagnostics.filter((d)=>d.severity==="error")) {
    if (diagnostic.code==="BLK-MODEL-TOOLS") continue;
    if (diagnostic.code==="BLK-RESOURCE-001" && issues.some((issue)=>issue.kind==="model" && issue.moduleId===diagnostic.source?.moduleId && issue.blockId===diagnostic.source?.blockId)) continue;
    add({kind:"project",code:diagnostic.code,message:diagnostic.message,moduleId:diagnostic.source?.moduleId,blockId:diagnostic.source?.blockId});
  }
  return { ready: issues.length===0 && !compiled.diagnostics.some((d)=>d.severity==="error") && compiled.interaction.entries.length>0, issues, needsWorkspace, knowledge };
}
