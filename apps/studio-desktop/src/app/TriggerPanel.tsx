import {useEffect,useRef,useState} from 'react';
import {compileProject} from '@blocky/compiler';
import {hostAdapters,resolveRunEntry,TriggerScheduler,triggerConfigSchema,type TriggerConfig,type TriggerListItem,type TriggerOutcome} from '@blocky/runtime-core';
import {DesktopRuntime} from '../composition/desktop-runtime';
import {studioAgentServices} from '../composition/agent';
import {knowledgeNative} from '../composition/knowledge';
import {studioRpaModules} from '../composition/rpaModules';
import {studioTriggers} from '../composition/triggers';
import type {Studio} from '../composition/useStudio';

type Entry={moduleId:string;interactionId:string};
const safeError=(error:unknown)=>/\bBLK-(?:[A-Z0-9]+-)*[A-Z0-9]+\b/.exec(error instanceof Error?error.message:String(error))?.[0]??'BLK-TRIGGER-OPERATION';
function delay(signal:AbortSignal){return new Promise<void>(resolve=>{const done=()=>{clearTimeout(timer);signal.removeEventListener('abort',done);resolve();};const timer=setTimeout(done,500);signal.addEventListener('abort',done,{once:true});if(signal.aborted)done();});}
export function TriggerPanel({studio:s}:{studio:Studio}){
 const projectId=s.snapshot.project.manifest.projectId;
 const [entries,setEntries]=useState<Entry[]>([]),[entry,setEntry]=useState(''),[items,setItems]=useState<TriggerListItem[]>([]);
 const [type,setType]=useState<'timer'|'external'>('timer'),[at,setAt]=useState(()=>new Date(Date.now()+60000).toISOString()),[interval,setInterval]=useState('0'),[zone,setZone]=useState('UTC'),[misfire,setMisfire]=useState<'skip'|'latest'>('skip'),[source,setSource]=useState('local-events'),[secretRef,setSecretRef]=useState('');
 const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[endpoint,setEndpoint]=useState('');
 const active=useRef<{controller:AbortController;session:ReturnType<typeof studioTriggers>}|undefined>(undefined),mounted=useRef(true);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;active.current?.controller.abort();};},[]);
 useEffect(()=>{let live=true;void compileProject(s.snapshot.project,s.resources.map).then(compiled=>{
  const next=compiled.interaction.entries.filter(e=>{const root=compiled.modules.find(m=>m.moduleId===e.moduleId)?.roots.find(n=>n.nodeId===e.ownerAgentId);return !!root&&resolveRunEntry(root,e.interactionId)?.workflowRoot?.blockType==='runtime.task.durable';}).map(e=>({moduleId:e.moduleId,interactionId:e.interactionId}));
  if(live)setEntries(next);
 }).catch(()=>{if(live)setEntries([]);});return()=>{live=false;};},[s.snapshot.project,s.resources.map]);
 async function operation(work:(session:ReturnType<typeof studioTriggers>,signal:AbortSignal)=>Promise<void>){
  if(active.current)return;const controller=new AbortController(),session=studioTriggers(projectId);active.current={controller,session};setBusy(true);setMessage('');
  try{await work(session,controller.signal);}catch(error){if(mounted.current)setMessage(controller.signal.aborted?'已停止；未结算事件保留，需核对原工作流。':safeError(error));}
  finally{try{await session.close();}catch{if(mounted.current)setMessage('BLK-TRIGGER-CLOSE');}finally{active.current=undefined;if(mounted.current){setBusy(false);setEndpoint('');}}}
 }
 const selected=entries.find(e=>`${e.moduleId}/${e.interactionId}`===entry)??entries[0];
 function outcome(value:TriggerOutcome){if(!mounted.current)return;setMessage(value.kind==='completed'?`已完成：${value.record.occurrenceId}`:value.kind==='blocked'?`事件待核对：${value.workflowTaskId??value.record.occurrenceId}；请在持久工作流中继续或核对，触发器不会重跑。`:value.kind==='skipped'?`等待触发：${value.reason}`:('errorCode'in value?value.errorCode:'事件已领取，未重复执行。'));}
 async function start(config:TriggerConfig){await operation(async(session,signal)=>{
  const scheduler=new TriggerScheduler({client:session.client,createRuntime:()=>{const runtime=new DesktopRuntime(()=>hostAdapters(knowledgeNative,studioAgentServices(),studioRpaModules(s.rpaInput.request)));return {project:s.controller.getSnapshot().project,userRegistry:s.resources.map,runtime,dispose:()=>runtime.dispose()};}});
  if(config.type==='timer'){await scheduler.watch(config.triggerId,signal,outcome);return;}
  const receiver=await session.receivers.start(config.triggerId,config.revision,secretRef,signal);if(mounted.current)setEndpoint(receiver.endpoint);
  try{while(!signal.aborted){const batch=await session.receivers.poll(receiver.receiverId,signal);if(!batch.active)break;const freshIds=batch.events.map(event=>event.occurrence.occurrenceId);for(const event of batch.events){const result=await scheduler.runExternal(event.occurrence,event.payload,signal,freshIds);outcome(result);if(result.kind!=='completed')return;}await delay(signal);}}
  finally{await session.receivers.stop(receiver.receiverId);}
 });}
 return <section aria-label="项目触发器"><h3>项目触发器</h3><p>运行时须保持此窗口打开。关闭或停止后不自动重放；定时采用 UTC 时间与固定偏移，不调整夏令时。</p>
 <fieldset disabled={busy}><label>持久工作流入口<select value={selected?`${selected.moduleId}/${selected.interactionId}`:''} onChange={e=>setEntry(e.target.value)}>{entries.map(e=><option key={`${e.moduleId}/${e.interactionId}`} value={`${e.moduleId}/${e.interactionId}`}>{e.moduleId} · {e.interactionId}</option>)}</select></label>
 <label>触发方式<select value={type} onChange={e=>setType(e.target.value as typeof type)}><option value="timer">定时</option><option value="external">外部事件</option></select></label>
 {type==='timer'?<><label>开始时间（ISO，含时区）<input value={at} onChange={e=>setAt(e.target.value)}/></label><label>间隔秒（0 为一次）<input type="number" min="0" value={interval} onChange={e=>setInterval(e.target.value)}/></label><label>显示时区<input value={zone} onChange={e=>setZone(e.target.value)}/></label><label>错过时点<select value={misfire} onChange={e=>setMisfire(e.target.value as typeof misfire)}><option value="skip">跳过</option><option value="latest">仅执行最近一次</option></select></label></>:<label>来源 ID<input value={source} onChange={e=>setSource(e.target.value)}/></label>}
 <button disabled={!selected} onClick={()=>void operation(async(session,signal)=>{if(!selected)throw Error('BLK-TRIGGER-WORKFLOW-REQUIRED');const base={schemaVersion:'blocky.trigger/v1',triggerId:`trigger-${crypto.randomUUID()}`,projectId,...selected,exportId:selected.interactionId,revision:1,enabled:true};const {interactionId,...fields}=base;const config=triggerConfigSchema.parse(type==='external'?{...fields,type,sourceId:source}:{...fields,type,schedule:{kind:Number(interval)===0?'once':'interval',startsAt:Date.parse(at),timeZone:zone,misfire,...(Number(interval)===0?{}:{intervalMs:Number(interval)*1000})}});await session.client.upsert(config,null,signal);setItems(await session.client.list(signal));})}>创建触发器</button>
 <button onClick={()=>void operation(async(session,signal)=>setItems(await session.client.list(signal)))}>刷新记录</button><label>外部事件密钥引用<input value={secretRef} onChange={e=>setSecretRef(e.target.value)} placeholder="本机安全存储引用"/></label></fieldset>
 {!entries.length&&<p>当前项目没有持久工作流入口，请先添加持久工作流。</p>}
 {items.map(({config,occurrences})=><div key={config.triggerId}><p>{config.triggerId} · {config.type==='timer'?'定时':'外部事件'} · {config.enabled?'已启用':'已暂停'} · 修订 {config.revision}</p><button disabled={busy||!config.enabled||(config.type==='external'&&!secretRef)} onClick={()=>void start(config)}>开始监听</button><button disabled={busy} onClick={()=>void operation(async(session,signal)=>{await session.client.pause(config.triggerId,config.revision,config.enabled,signal);setItems(await session.client.list(signal));})}>{config.enabled?'暂停':'启用'}</button><p>已领取 {occurrences.filter(r=>r.status==='claimed').length} · 已完成 {occurrences.filter(r=>r.status==='completed').length} · 已失败 {occurrences.filter(r=>r.status==='failed').length}</p></div>)}
 {busy&&<button onClick={()=>active.current?.controller.abort()}>停止监听</button>}{endpoint&&<p>本机事件接收地址：{endpoint}</p>}{message&&<p role="status">{message}</p>}</section>;
}
