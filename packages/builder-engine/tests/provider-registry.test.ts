import { expect, it } from "vitest";
import { readBuilderRegistry } from "../src/provider-registry";
import { emptyRegistry, upsertModelProvider, upsertUserResource, referenceUserResource, resolveResource, resolveRegistryResources } from "../../resource-registry/src";
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
