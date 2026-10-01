import { z } from "zod";
import { stableId, canonicalJson, type Json, type Resource } from "@blocky/language-schema";
import { RunBudget, utf8 } from "./budget";
const id = z.string().max(128).regex(stableId);
const permission = z.string().regex(/^[a-z][a-z0-9.-]{0,79}$/);
export const delegationSchema = z.object({
  tasks: z.array(z.object({ agentId:id, resourceId:id, permissions:z.array(permission).max(32), instruction:z.string().max(2048).default("") }).strict()).min(1).max(8),
  mode:z.enum(["sequential", "parallel"]), failurePolicy:z.enum(["stop", "collect"]),
}).strict().superRefine((v,c)=>{if(new Set(v.tasks.map(t=>t.agentId)).size!==v.tasks.length)c.addIssue({code:"custom",message:"duplicate agent identity"});});
export type Delegation = z.infer<typeof delegationSchema>;
export type AgentTask = { taskId:string; parentTaskId:string; agentId:string; resourceId:string; permissions:string[]; instruction:string };
export type AgentTaskResult = AgentTask & { status:"completed"|"failed"|"skipped"; value?:Json; code?:string };
export const taskCode = (error:unknown) => error instanceof Error && /^BLK-[A-Z0-9-]{3,64}$/.test(error.message)?error.message:"BLK-AGENT-TASK";
/** All proposals are checked before the first effect. Children share the owner's budget. */
export async function delegateTasks(options:{spec:Delegation; parentTaskId:string; capabilities:readonly string[]; input:Json; budget:RunBudget;
  resolve(id:string):Resource; invoke(task:AgentTask,resource:Resource,input:Json):Promise<Json>; event(task:AgentTask,status:"started"|"completed"|"failed",code?:string):void;
}):Promise<AgentTaskResult[]> {
  const spec=delegationSchema.parse(options.spec);
  const bound=spec.tasks.map((item,index)=>{
    const resource=options.resolve(item.resourceId);
    if (!item.permissions.every(p=>options.capabilities.includes(p)) || new Set(item.permissions).size!==item.permissions.length
      || ![...resource.capabilityRequirements,...(Array.isArray(resource.definition.permissions)?resource.definition.permissions:[])].every(p=>typeof p==='string'&&item.permissions.includes(p))
      || resource.definition.implementationRef===null || typeof resource.definition.implementationRef!=='object' || Array.isArray(resource.definition.implementationRef)
      || resource.definition.implementationRef.kind!=='adapter' || resource.definition.implementationRef.id!=='module-tool-v1') throw Error('BLK-AGENT-PERMISSION');
    return {resource,task:{...item,parentTaskId:options.parentTaskId,taskId:`task-${crypto.randomUUID()}`}} satisfies {resource:Resource;task:AgentTask};
  });
  options.budget.check();
  if(options.budget.calls+bound.length>options.budget.maxCalls)throw Error('BLK-RUN-004');
  let stopped=false;
  const run=async({resource,task}:typeof bound[number],input:Json):Promise<AgentTaskResult>=>{
    if(stopped)return {...task,status:'skipped',code:'BLK-AGENT-DEPENDENCY'};
    options.budget.check();options.budget.call();options.event(task,'started');
    try {
      const value=await options.invoke(task,resource,structuredClone(input));
      options.budget.check();if(utf8(canonicalJson(value))>32768)throw Error('BLK-AGENT-LIMIT');
      options.event(task,'completed');return {...task,status:'completed',value};
    }catch(error){
      if(spec.failurePolicy==='stop')stopped=true;
      const code=taskCode(error);options.event(task,'failed',code);return {...task,status:'failed',code};
    }
  };
  let results:AgentTaskResult[];
  if(spec.mode==='parallel')results=await Promise.all(bound.map(item=>run(item,options.input)));
  else {results=[];let input=options.input;for(const item of bound){const result=await run(item,input);results.push(result);if(result.status==='completed')input=result.value!;}}
  // All started tasks have settled. Cancellation cannot publish a partial success.
  options.budget.check();
  if(utf8(canonicalJson(results as unknown as Json))>32768)throw Error('BLK-AGENT-LIMIT');
  return results;
}
