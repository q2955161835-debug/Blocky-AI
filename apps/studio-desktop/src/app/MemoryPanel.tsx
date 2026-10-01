import { useEffect, useRef, useState } from "react";
import { ProjectMemory, type MemoryInput, type MemoryEntry, type MemoryResult } from "@blocky/runtime-core";
import { studioAgentServices } from "../composition/agent";
/** This keyed panel owns a short-lived native grant; values never enter the project. */
export function MemoryPanel({ projectId, retentionDays = 0, sourceRef = "" }: { projectId: string; retentionDays?: number; sourceRef?: string }) {
  const [key,setKey]=useState("");
  const [text,setText]=useState("null");
  const [source,setSource]=useState(sourceRef);
  const [summary,setSummary]=useState("");
  const [ttl,setTtl]=useState(String(retentionDays*86400));
  const [policy,setPolicy]=useState<"replace"|"merge"|"reject">("reject");
  const [version,setVersion]=useState(0);
  const [query,setQuery]=useState("");
  const [entries,setEntries]=useState<{key:string;entry:MemoryEntry}[]>([]);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  const active=useRef<AbortController|null>(null);
  const alive=useRef(true);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;active.current?.abort();};},[]);
  async function operate(input:MemoryInput, consume:(result:MemoryResult)=>void) {
    if(active.current)return;
    const controller=new AbortController();active.current=controller;setBusy(true);setMessage("");
    const services=studioAgentServices();
    try {
      const memory=new ProjectMemory(services.memoryEntries!,projectId,`memory-panel-${crypto.randomUUID()}`);
      const result=await memory.request(input,controller.signal);
      if(alive.current&&!controller.signal.aborted){consume(result);setMessage("记忆操作完成。");}
    } catch(error) {
      if(alive.current)setMessage(error instanceof Error&&error.message==="BLK-MEMORY-CONFLICT" ? "条目已变更。重新读取当前版本并审阅后再保存。" : "记忆操作未完成，请检查标识、JSON、有效期和本机权限；停止写入后请重新读取确认结果。");
    } finally {
      await services.close?.(controller.signal);
      if(active.current===controller)active.current=null;
      if(alive.current)setBusy(false);
    }
  }
  function load(target=key) {
    void operate({action:"read",key:target},r=>{
      setKey(target);setVersion(r.version??0);setText(JSON.stringify(r.entry?.value??null,null,2));
      setSource(r.entry?.sourceRef??sourceRef);setSummary(r.entry?.summaryKind==="manual"?r.entry.summary:"");
      setTtl(r.entry?.expiresAt?String(Math.max(1,r.entry.expiresAt-Math.floor(Date.now()/1000))):String(retentionDays*86400));
    });
  }
  function save() {
    try {
      const value=JSON.parse(text),ttlSeconds=Number(ttl);
      void operate({action:"upsert",key,value,expectedVersion:version,conflictPolicy:policy,ttlSeconds,
        ...(source?{sourceRef:source}:{}),...(summary?{summary}: {})},r=>{setVersion(r.entry!.version);});
    } catch {setMessage("内容须为有效 JSON。");}
  }
  return <section aria-label="项目记忆">
    <h3>项目记忆</h3>
    <p>记忆保存在本机；有效期 0 表示保留至主动删除。摘要为空时自动摘取原文。</p>
    <label>搜索<input aria-label="搜索记忆" value={query} onChange={e=>setQuery(e.target.value)}/></label>
    <button disabled={busy} onClick={()=>void operate({action:"search",query,limit:50},r=>setEntries(r.entries??[]))}>搜索记忆</button>
    <ul>{entries.map(item=><li key={item.key}><button disabled={busy} onClick={()=>load(item.key)}>{item.key}</button><span> · {item.entry.summary} · {item.entry.summaryKind==="manual"?"人工摘要":"原文摘取"} · v{item.entry.version}{item.entry.sourceRef?` · ${item.entry.sourceRef}`:""}</span></li>)}</ul>
    <fieldset disabled={busy}>
      <label>标识<input aria-label="记忆标识" value={key} onChange={e=>{setKey(e.target.value);setVersion(0);}}/></label>
      <button onClick={()=>load()}>读取当前版本</button><p>当前版本：{version}</p>
      <label>内容 JSON<textarea aria-label="记忆内容" value={text} onChange={e=>setText(e.target.value)}/></label>
      <label>来源<input aria-label="记忆来源" value={source} onChange={e=>setSource(e.target.value)}/></label>
      <label>人工摘要<textarea aria-label="记忆摘要" value={summary} onChange={e=>setSummary(e.target.value)}/></label>
      <label>有效期（秒）<input aria-label="记忆有效期" type="number" min="0" max="3153600000" value={ttl} onChange={e=>setTtl(e.target.value)}/></label>
      <label>已有内容<select aria-label="记忆冲突策略" value={policy} onChange={e=>setPolicy(e.target.value as typeof policy)}><option value="reject">保留已有条目</option><option value="replace">按当前版本替换</option><option value="merge">合并对象字段</option></select></label>
      <button onClick={save}>保存记忆</button>
      <button onClick={()=>void operate({action:"delete",key,expectedVersion:version},r=>{setVersion(r.version!);setText("null");setEntries(items=>items.filter(i=>i.key!==key));})}>删除记忆</button>
      <button disabled={!source} onClick={()=>void operate({action:"revoke-source",sourceRef:source},()=>setEntries(items=>items.filter(i=>i.entry.sourceRef!==source)))}>撤销此来源的记忆</button>
      <button disabled={!source} onClick={()=>void operate({action:"allow-source",sourceRef:source},()=>{})}>允许此来源的新记忆</button>
    </fieldset>
    {busy&&<button onClick={()=>active.current?.abort()}>停止记忆操作</button>}
    {message&&<p role="status">{message}</p>}
  </section>;
}
