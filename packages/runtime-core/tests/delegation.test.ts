import {expect,it} from 'vitest';
import {delegateTasks, type AgentTask} from '../src/delegation';
import {RunBudget} from '../src/budget';
import type {Resource,Json} from '@blocky/language-schema';
const resource:Resource={schemaVersion:'blocky.resource/v1alpha1',resourceId:'worker',kind:'tool',scope:'project',displayName:'worker',definition:{version:'1',permissions:['module.execute'],implementationRef:{kind:'adapter',id:'module-tool-v1'}},capabilityRequirements:['module.execute'],secretBindings:[]};
const tasks=[{agentId:'first',resourceId:'worker',permissions:['module.execute'],instruction:'first role'},{agentId:'second',resourceId:'worker',permissions:['module.execute'],instruction:'second role'}];
it('validates all narrowed permissions before effects and shares call budget',async()=>{
 const budget=new RunBudget();let calls=0;
 const base={parentTaskId:'parent',capabilities:['module.execute'],input:'input',budget,resolve:()=>resource,invoke:async()=>{calls++;return 'value'},event:()=>{}};
 try{
 await expect(delegateTasks({...base,spec:{tasks:[tasks[0],{...tasks[1],permissions:['module.execute','network.request']}],mode:'parallel',failurePolicy:'collect'}})).rejects.toThrow('BLK-AGENT-PERMISSION');expect(calls).toBe(0);
 budget.maxCalls=1;await expect(delegateTasks({...base,spec:{tasks,mode:'parallel',failurePolicy:'collect'}})).rejects.toThrow('BLK-RUN-004');expect(calls).toBe(0);
 }finally{budget.dispose();}
});
it('hands completed output to the next actual task and records independent provenance',async()=>{
 const budget=new RunBudget();const inputs:Json[]=[],events:string[]=[];
 try{const results=await delegateTasks({spec:{tasks,mode:'sequential',failurePolicy:'stop'},parentTaskId:'parent',capabilities:['module.execute'],input:'start',budget,resolve:()=>resource,
 invoke:async(task,_,input)=>{inputs.push(input);return task.agentId;},event:(t,s)=>events.push(t.agentId+':'+s)});
 expect(inputs).toEqual(['start','first']);expect(budget.calls).toBe(2);expect(new Set(results.map(r=>r.taskId)).size).toBe(2);expect(results.every(r=>r.parentTaskId==='parent'&&r.status==='completed')).toBe(true);expect(events).toHaveLength(4);
 }finally{budget.dispose();}
});
it('settles all started parallel tasks, keeps failures, and refuses success after stop',async()=>{
 const parent=new AbortController(),budget=new RunBudget(parent.signal);let settled=0;
 try{
 const work=delegateTasks({spec:{tasks,mode:'parallel',failurePolicy:'collect'},parentTaskId:'parent',capabilities:['module.execute'],input:'start',budget,resolve:()=>resource,
 invoke:async(task)=>{await new Promise(r=>setTimeout(r,task.agentId==='first'?5:20));settled++;return task.agentId;},event:()=>{}});
 parent.abort(Error('BLK-RUN-005'));await expect(work).rejects.toThrow('BLK-RUN-005');expect(settled).toBe(2);
 }finally{budget.dispose();}
});
it('does not start sequential dependent tasks after failure',async()=>{
 const budget=new RunBudget();let calls=0;
 try{const result=await delegateTasks({spec:{tasks,mode:'sequential',failurePolicy:'stop'},parentTaskId:'parent',capabilities:['module.execute'],input:'start',budget,resolve:()=>resource,invoke:async()=>{calls++;throw Error('BLK-TOOL-002')},event:()=>{}});expect(calls).toBe(1);expect(result.map(r=>r.status)).toEqual(['failed','skipped']);}finally{budget.dispose();}
});
