import { z } from "zod";
import { parseRegistry, parseModelProvider, providerAdapters, upsertModelProvider,
  removeModelProvider, upsertUserResource, resolveRegistryResources } from "@blocky/resource-registry";
import { createSettings, parseSettings, updateSetting } from "@blocky/settings-core";
import { allow, required, type Args } from "./arguments";
import { CliError, envelope } from "./protocol";
import { readJsonArtifact } from "./artifacts";
import { nativeUserOperation } from "./native-store";
import { readUserRegistry, requireOnlineModel } from "./user-config";
import { errorGuidance } from "./error-guidance";
const id = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
const bindings = z.array(z.object({ fieldId: z.enum(["apiKey","baseUrl","headers"]), secretRef:id }).strict()).max(3);
export const modelProviderSchema = z.object({schemaVersion:z.literal("blocky.model-provider/v1"),providerId:id,
  displayName:z.string().min(1).max(120),adapter:z.enum(providerAdapters),protocol:z.literal("openai-chat"),
  revision:z.number().int().min(1).max(2147483647),secretBindings:bindings}).strict();
export const connectedModelSchema = z.object({schemaVersion:z.literal("blocky.resource/v1alpha1"),resourceId:id,
  displayName:z.string().min(1).max(120),kind:z.literal("model"),scope:z.literal("user"),
  capabilityRequirements:z.array(id).max(256),secretBindings:z.array(z.never()).max(0),
  definition:z.object({connectionRef:id,modelId:z.string().min(1).max(128).regex(/^[A-Za-z0-9._:/@-]+$/),
    timeoutMs:z.number().int().min(1).max(3600000),
    capabilities:z.array(z.enum(["text","image","audio","tools","structured-output","embedding","rerank"])).min(1).max(7),
    parameters:z.object({temperature:z.number().min(0).max(2).optional(),topP:z.number().min(0).max(1).optional(),
      maxOutputTokens:z.number().int().min(1).max(10000000).optional()}).strict().optional(),
  }).strict()}).strict();
export const modelProfilesHelp = [
  "provider list --json", "provider set --definition <provider.json> --json", "provider delete --id <id> --json",
  "model-profile list --json", "model-profile set --definition <model.json> --json", "model-profile delete --id <id> --json",
  "model-profile default --id <id> --json", "resource migrate --json", "resource rollback --json",
];
export async function modelProfilesCommand(args:Args) {
  const [kind,action]=args.words, key=`${kind}.${action}`;
  if(!["provider","model-profile"].includes(kind) && !["resource.migrate","resource.rollback"].includes(key)) return;
  const specs:Record<string,string[]>={"provider.list":[],"provider.set":["definition"],"provider.delete":["id"],
    "model-profile.list":[],"model-profile.set":["definition"],"model-profile.delete":["id"],"model-profile.default":["id"],
    "resource.migrate":[],"resource.rollback":[]};
  if(!Object.hasOwn(specs,key)) throw new CliError(2,"BLK-CLI-002","命令不存在。");
  allow(args,["json",...specs[key]],2);for(const field of specs[key]) required(args,field);
  try {
    if(kind==="resource") {
      const raw:any=await nativeUserOperation("user-read",{stateKind:"resources",stateId:"app"});
      if(action==="rollback") {
        if(raw?.schemaVersion!=="blocky.resource-registry/v2") throw Error("BLK-RESOURCE-BACKUP-MISSING");
        await nativeUserOperation("user-resource-rollback",{stateKind:"resources",stateId:"app",stateValue:{expectedRevision:raw.revision}});
        return {code:0,result:envelope(key,{restored:true})};
      }
      if(raw?.schemaVersion!=="blocky.resource-registry/v1") return {code:0,result:envelope(key,{migrated:false})};
      const next=parseRegistry(raw);next.revision++;
      await nativeUserOperation("user-write",{stateKind:"resources",stateId:"app",stateValue:next});
      return {code:0,result:envelope(key,{migrated:true,providers:next.providers.length,models:next.resources.filter(r=>r.kind==="model").length})};
    }
    const registry=await readUserRegistry();
    if(action==="list") return {code:0,result:envelope(key,kind==="provider"?{providers:registry.providers,revision:registry.revision}:{models:registry.resources.filter(r=>r.kind==="model"),revision:registry.revision})};
    if(action==="default") {
      const modelId=requireOnlineModel(required(args,"id"),resolveRegistryResources(registry));
      const raw=await nativeUserOperation("user-read",{stateKind:"settings",stateId:"app"});
      const settings=raw===null?createSettings("app"):parseSettings(raw);
      if(settings.scope!=="app") throw Error();
      await nativeUserOperation("user-write",{stateKind:"settings",stateId:"app",stateValue:updateSetting(settings,"models.defaultResourceId",modelId)});
      return {code:0,result:envelope(key,{saved:true,defaultResourceId:modelId})};
    }
    let next=registry;
    if(kind==="provider") {
      if(action==="set") next=upsertModelProvider(registry,parseModelProvider(await readJsonArtifact(required(args,"definition"))));
      else {
        const providerId=required(args,"id"),dependents=registry.resources.filter(r=>r.definition.connectionRef===providerId).map(r=>r.resourceId);
        if(dependents.length) throw new CliError(3,"BLK-PROVIDER-IN-USE","厂商连接仍被模型引用。",`先修改或删除这些模型：${dependents.join(", ")}。`);
        next=removeModelProvider(registry,providerId);
      }
    } else if(action==="set") {
      const input=await readJsonArtifact(required(args,"definition"));
      const parsed=connectedModelSchema.parse(input);
      next=upsertUserResource(registry,parsed);
    } else {
      const resourceId=required(args,"id");
      if(!registry.resources.some(r=>r.resourceId===resourceId&&r.kind==="model")) throw Error();
      next=parseRegistry({...registry,revision:registry.revision+1,resources:registry.resources.filter(r=>r.resourceId!==resourceId)});
    }
    await nativeUserOperation("user-write",{stateKind:"resources",stateId:"app",stateValue:next});
    return {code:0,result:envelope(key,{saved:true,revision:next.revision})};
  } catch(error) {
    if(error instanceof CliError) throw error;
    const code=error instanceof Error && /^(BLK-RESOURCE-CONFLICT|BLK-RESOURCE-BACKUP-MISSING|BLK-PROVIDER-IN-USE)$/.test(error.message)?error.message:"BLK-MODEL-CONFIG";
    const advice=errorGuidance(code);
    throw new CliError(3,code,advice?.message??"厂商或模型配置无效；原配置保留。",advice?.hint??"查询 provider list、model-profile list 与相应 Schema 后修正定义。");
  }
}
