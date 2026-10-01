import { expect, it } from "vitest";
import { readBuilderRegistry } from "../src/provider-registry";
import { emptyRegistry, parseRegistry, upsertModelProvider, upsertUserResource, referenceUserResource, resolveResource, resolveRegistryResources } from "../../resource-registry/src";
import { modelResource } from "../../../tests/fixtures/model-resource";
import { createStarter } from "../../test-fixtures/src";
it("resolves the IPC provider ledger into authorized user model references", () => {
  let r=upsertModelProvider(emptyRegistry(),{schemaVersion:"blocky.model-provider/v1",providerId:"shared",displayName:"Shared",adapter:"xirang",protocol:"openai-chat",revision:1,secretBindings:[{fieldId:"apiKey",secretRef:"key1"}]});
  r=upsertUserResource(r,{...modelResource("online"),definition:{connectionRef:"shared",modelId:"model-one",timeoutMs:60000,capabilities:["text","tools"]},secretBindings:[]});
  const project=referenceUserResource(createStarter(),resolveRegistryResources(r).get("online")!);
  const map=readBuilderRegistry(JSON.parse(JSON.stringify(r)));
  expect(resolveResource(project,"online","model",map).definition.provider).toBe("xirang");
  expect(readBuilderRegistry([modelResource()]).size).toBe(1);
  expect(()=>readBuilderRegistry({ ...r, providers:[] })).toThrow();
});
it("migrates legacy resource arrays consistently before a first persistent write",()=>{
  const raw=[modelResource()];
  const resource=resolveRegistryResources(parseRegistry({schemaVersion:"blocky.resource-registry/v1",resources:raw})).get("saved-model")!;
  const project=referenceUserResource(createStarter(),resource);
  expect(()=>resolveResource(project,"saved-model","model",readBuilderRegistry(raw))).not.toThrow();
});
