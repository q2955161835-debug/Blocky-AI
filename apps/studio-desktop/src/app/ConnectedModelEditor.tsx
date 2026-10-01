import type { Resource } from "@blocky/language-schema";
import type { ModelProvider } from "@blocky/resource-registry";
const capabilities=[ ["text","文本"],["image","图片"],["tools","工具调用"],["structured-output","结构化输出"] ] as const;
const parameters=[ ["temperature","温度",0,2,false],["topP","Top P",0,1,false],["maxOutputTokens","输出 Token 上限",1,10000000,true],["contextLength","上下文长度",1,10000000,true] ] as const;
export function ConnectedModelEditor({resource,providers,change}:{resource:Resource;providers:ModelProvider[];change(value:Resource):void}) {
  const d=resource.definition, caps=Array.isArray(d.capabilities)?d.capabilities:[];
  const params=(d.parameters??{}) as Record<string,number>;
  const set=(key:string,value:unknown)=>change({...resource,definition:{...d,[key]:value} as Resource["definition"]});
  return <fieldset><legend>自定义模型</legend>
    <label>厂商连接<select aria-label="模型厂商连接" value={String(d.connectionRef??"")} onChange={e=>set("connectionRef",e.target.value)}>
      <option value="">选择厂商连接</option>{providers.map(p=><option key={p.providerId} value={p.providerId}>{p.displayName}</option>)}
    </select></label>
    <label>模型 ID<input aria-label="模型 ID" value={String(d.modelId??"")} onChange={e=>set("modelId",e.target.value)}/></label>
    <label>超时（毫秒）<input aria-label="模型超时" type="number" min={1} max={3600000} value={Number(d.timeoutMs)} onChange={e=>set("timeoutMs",Number(e.target.value))}/></label>
    <fieldset><legend>模型能力</legend>{capabilities.map(([id,title])=><label key={id}><input type="checkbox" aria-label={`模型能力 ${title}`} checked={caps.includes(id)} onChange={e=>set("capabilities",e.target.checked?[...caps,id]:caps.filter(c=>c!==id))}/>{title}</label>)}</fieldset>
    {parameters.map(([key,title,min,max,integer])=><div key={key}>
      <label><input type="checkbox" aria-label={`启用模型参数 ${title}`} checked={Object.hasOwn(params,key)} onChange={e=>{
        const next={...params};if(e.target.checked)next[key]=key==="maxOutputTokens"?1024:min;else delete next[key];set("parameters",next);
      }}/>{title}</label>
      {Object.hasOwn(params,key)&&<input aria-label={`模型参数 ${title}`} type="number" min={min} max={max} step={integer?1:"any"} value={params[key]} onChange={e=>set("parameters",{...params,[key]:Number(e.target.value)})}/>}
    </div>)}
  </fieldset>;
}
