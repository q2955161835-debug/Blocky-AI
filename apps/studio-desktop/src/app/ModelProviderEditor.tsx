import type { Resource } from "@blocky/language-schema";
import { providerAdapters, type ModelProvider } from "@blocky/resource-registry";
import { SecretBindings } from "./SecretBindings";
export const providerNames:Record<ModelProvider["adapter"],string>={deepseek:"DeepSeek",xirang:"息壤","openai-compatible":"OpenAI 兼容",ollama:"Ollama"};
export function ModelProviderEditor({value,change}:{value:ModelProvider;change(value:ModelProvider):void}) {
  const fields=value.adapter==="deepseek"||value.adapter==="xirang"?["apiKey"]:["baseUrl","apiKey","headers"];
  const resource:Resource={schemaVersion:"blocky.resource/v1alpha1",resourceId:value.providerId,kind:"model",scope:"user",displayName:value.displayName,definition:{},capabilityRequirements:[],secretBindings:value.secretBindings};
  return <fieldset><legend>厂商连接</legend>
    <label>厂商名称<input aria-label="厂商名称" value={value.displayName} onChange={e=>change({...value,displayName:e.target.value})}/></label>
    <label>连接类型<select aria-label="厂商连接类型" value={value.adapter} onChange={e=>{
      const adapter=e.target.value as ModelProvider["adapter"];
      const allowed=adapter==="deepseek"||adapter==="xirang"?["apiKey"]:["baseUrl","apiKey","headers"];
      change({...value,adapter,secretBindings:value.secretBindings.filter(b=>allowed.includes(b.fieldId))});
    }}>{providerAdapters.map(adapter=><option key={adapter} value={adapter}>{providerNames[adapter]}</option>)}</select></label>
    <small>{value.providerId} · OpenAI Chat</small>
    <SecretBindings resource={resource} fields={fields} change={secretBindings=>change({...value,secretBindings})}/>
  </fieldset>;
}
