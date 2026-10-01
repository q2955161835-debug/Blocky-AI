import {useEffect,useMemo,useState} from 'react';
import {compileProject} from '@blocky/compiler';
import {digest,type Json} from '@blocky/language-schema';
import {resolveResource} from '@blocky/resource-registry';
import {NativeEvaluationStore,createRuntimeEvaluationExecutor,createEvaluationModelBinding,hostAdapters,type EvaluationModelBinding} from '@blocky/runtime-core';
import {DesktopRuntime} from '../composition/desktop-runtime';
import {studioAgentServices} from '../composition/agent';
import {knowledgeNative} from '../composition/knowledge';
import {studioRpaModules} from '../composition/rpaModules';
import type {Studio} from '../composition/useStudio';
import {EvaluationPanel} from './EvaluationPanel';
export function EvaluationWorkspace({studio:s}:{studio:Studio}) {
 const project=s.snapshot.project,registry=s.resources.map;
 const [binding,setBinding]=useState<{hash:string;model:EvaluationModelBinding;displayName:string}>(),[entries,setEntries]=useState<{interactionId:string;moduleId:string}[]>([]),[entryId,setEntryId]=useState(''),[error,setError]=useState('');
 const [store,setStore]=useState<NativeEvaluationStore>();
 useEffect(()=>{const services=studioAgentServices(),lifetime=new AbortController();
  setStore(new NativeEvaluationStore(services.evaluation!,project.manifest.projectId,`evaluation-ui-${crypto.randomUUID()}`,lifetime.signal));
  return()=>{lifetime.abort();void services.close?.(lifetime.signal);};
 },[project.manifest.projectId]);
 useEffect(()=>{let live=true;setBinding(undefined);setError('');void (async()=>{
  const compiled=await compileProject(project,registry);if(compiled.diagnostics.some(d=>d.severity==='error'))throw Error('BLK-EVAL-PROJECT');
  const modelRef=project.manifest.resources.find(r=>r.kind==='model');if(!modelRef)throw Error('BLK-EVAL-MODEL-BINDING');
  const model=resolveResource(project,modelRef.resourceId,'model',registry);const configurationHash=await digest({project,resources:[...registry.values()]} as unknown as Json),modelBinding=await createEvaluationModelBinding(model);
  if(live){setBinding({hash:configurationHash,model:modelBinding,displayName:model.displayName});setEntries(compiled.interaction.entries.map(e=>({interactionId:e.interactionId,moduleId:e.moduleId})));setEntryId('');}
 })().catch(e=>{if(live)setError(e instanceof Error&&/^BLK-/.test(e.message)?e.message:'BLK-EVAL-PROJECT');});return()=>{live=false;};},[project,registry]);
 const selected=entries.find(e=>`${e.moduleId}/${e.interactionId}`===entryId)??entries[0];
 const execute=useMemo(()=>selected?createRuntimeEvaluationExecutor({project,interactionId:selected.interactionId,moduleId:selected.moduleId,userRegistry:registry,createRuntime:()=>new DesktopRuntime(()=>hostAdapters(knowledgeNative,studioAgentServices(),studioRpaModules(s.rpaInput.request)))}):undefined,[project,registry,selected?.interactionId,selected?.moduleId,s.rpaInput.request]);
 return <section aria-label="评估工作台"><h3>评估工作台</h3>{error&&<p role="alert">{error}</p>}<label>项目入口<select value={selected?`${selected.moduleId}/${selected.interactionId}`:''} onChange={e=>setEntryId(e.target.value)}>{entries.map(e=><option key={`${e.moduleId}/${e.interactionId}`} value={`${e.moduleId}/${e.interactionId}`}>{e.moduleId} · {e.interactionId}</option>)}</select></label>{binding&&<p>模型配置：{binding.displayName} · {binding.model.version}；每例使用独立会话。</p>}{binding&&execute&&store&&<EvaluationPanel project={project} model={binding.model} bindingHash={binding.hash} store={store} execute={execute}/>}</section>;
}
