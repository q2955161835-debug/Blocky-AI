import { useState,useEffect,useRef } from "react";
import type { Resource } from "@blocky/language-schema";
import { validateResource,parseModelProvider, type ModelProvider } from "@blocky/resource-registry";
import type { useResources } from "../composition/useResources";
import { ModelProviderEditor } from "./ModelProviderEditor";
import { ConnectedModelEditor } from "./ConnectedModelEditor";
export function ModelManagerPanel({resources,defaultModelId,setDefault,reference,autoSave=false,onDirty}:{
  resources:ReturnType<typeof useResources>;defaultModelId:string;setDefault(id:string):Promise<unknown>;reference(resource:Resource):void;autoSave?:boolean;onDirty?(dirty:boolean):void;
}) {
  const [provider,setProvider]=useState<ModelProvider>(),[model,setModel]=useState<Resource>(),[error,setError]=useState(""),[busy,setBusy]=useState(false);
  const providers=resources.registry.providers??[];
  const failed=useRef("");
  const signature=JSON.stringify(provider??model??null);
  const stored=provider?providers.find(p=>p.providerId===provider.providerId):model?resources.registry.resources.find(r=>r.resourceId===model.resourceId):undefined;
  const dirty=!!(provider||model)&&signature!==JSON.stringify(stored??null);
  useEffect(()=>{onDirty?.(dirty||busy);},[dirty,busy,onDirty]);
  useEffect(()=>{
    if(!autoSave||!dirty||busy||failed.current===signature)return;
    try{if(provider)parseModelProvider(provider);else if(model)validateResource(model);else return;}catch{return;}
    const timer=setTimeout(()=>{
      setBusy(true);setError("");
      const task=provider?resources.upsertProvider(provider):resources.upsert(model!);
      void task.then(()=>{
        if(provider)setProvider({...provider,revision:stored?(stored as ModelProvider).revision+1:1});
        failed.current="";
      }).catch(cause=>{
        failed.current=signature;
        setError(String(cause).includes("BLK-RESOURCE-CONFLICT")?"配置已被其他窗口修改，草稿保留。请重新打开记录核对差异。":"自动保存失败，原配置与草稿保留，请检查字段或重试保存。");
      }).finally(()=>setBusy(false));
    },650);
    return()=>clearTimeout(timer);
  },[autoSave,dirty,busy,signature,resources.registry.revision]);
  const perform=async(task:()=>Promise<unknown>,done?:()=>void)=>{
    setBusy(true);setError("");try{await task();done?.();}catch(cause){
      const conflict=String(cause).includes("BLK-RESOURCE-CONFLICT");
      setError(conflict?"配置已被其他写入修改，草稿保留；请重新打开当前记录并审查差异。":"未保存，原配置与当前草稿保留；请检查字段和存储状态。");
    }finally{setBusy(false);}
  };
  return <section className="model-manager"><h3>厂商与模型</h3>
    <button disabled={!resources.ready||busy} onClick={()=>{setProvider({schemaVersion:"blocky.model-provider/v1",providerId:`provider-${crypto.randomUUID()}`,displayName:"新厂商",adapter:"deepseek",protocol:"openai-chat",revision:1,secretBindings:[]});setModel(undefined);setError("");}}>添加厂商</button>
    {providers.length===0&&<p>先添加厂商连接，再创建自定义模型。</p>}
    {providers.map(p=><section key={p.providerId} aria-label={`厂商 ${p.displayName}`}><h4>{p.displayName}</h4>
      <button disabled={busy} aria-label={`编辑厂商 ${p.displayName}`} onClick={()=>{setProvider(structuredClone(p));setModel(undefined);setError("");}}>编辑厂商</button>
      <button disabled={busy} onClick={()=>{
        const ids=resources.registry.resources.filter(r=>r.definition.connectionRef===p.providerId).map(r=>r.resourceId);
        if(ids.length){setError(`厂商仍被模型引用：${ids.join(", ")}。`);return;}
        void perform(()=>resources.removeProvider(p.providerId));
      }}>删除厂商</button>
      <button disabled={busy} aria-label={`添加模型 ${p.displayName}`} onClick={()=>{setProvider(undefined);setError("");setModel({schemaVersion:"blocky.resource/v1alpha1",resourceId:`model-${crypto.randomUUID()}`,displayName:"新模型",kind:"model",scope:"user",definition:{connectionRef:p.providerId,modelId:"",timeoutMs:60000,capabilities:["text"],parameters:{maxOutputTokens:1024}},secretBindings:[],capabilityRequirements:[]});}}>添加模型</button>
      {resources.registry.resources.filter(r=>r.kind==="model"&&r.definition.connectionRef===p.providerId).map(r=><div key={r.resourceId}>
        <strong>{r.displayName}</strong><small> · {String(r.definition.modelId)}{defaultModelId===r.resourceId?" · 默认":""}</small>
        <button disabled={busy} aria-label={`编辑模型 ${r.displayName}`} onClick={()=>{setModel(structuredClone(r));setProvider(undefined);setError("");}}>编辑</button>
        <button disabled={busy} onClick={()=>void perform(()=>setDefault(r.resourceId))}>设为默认</button>
        <button disabled={busy} onClick={()=>reference(r)}>引用到当前项目</button>
        <button disabled={busy} aria-label={`删除模型 ${r.displayName}`} onClick={()=>void perform(()=>resources.remove(r.resourceId))}>删除</button>
      </div>)}
    </section>)}
    {provider&&<fieldset disabled={busy}><ModelProviderEditor value={provider} change={setProvider}/>
      <button onClick={()=>void perform(()=>resources.upsertProvider(provider),()=>setProvider(undefined))}>保存厂商</button><button onClick={()=>setProvider(undefined)}>取消厂商编辑</button>
    </fieldset>}
    {model&&<fieldset disabled={busy}><label>显示名称<input aria-label="模型显示名称" value={model.displayName} onChange={e=>setModel({...model,displayName:e.target.value})}/></label>
      <small>{model.resourceId}</small><ConnectedModelEditor resource={model} providers={providers} change={setModel}/>
      <button onClick={()=>void perform(async()=>resources.upsert(validateResource(model)),()=>setModel(undefined))}>保存模型</button><button onClick={()=>setModel(undefined)}>取消模型编辑</button>
    </fieldset>}
    {error&&<p role="alert">{error}</p>}
  </section>;
}
