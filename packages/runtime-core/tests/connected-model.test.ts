import { expect, it } from "vitest";
import { modelResource } from "../../../tests/fixtures/model-resource";
import { parseRegistry, resolveRegistryResources } from "../../resource-registry/src";
import { nativeModelRequest } from "../src/native-model";
const model=(parameters={maxOutputTokens:512})=>resolveRegistryResources(parseRegistry({schemaVersion:"blocky.resource-registry/v1",resources:[{...modelResource(),definition:{...modelResource().definition,parameters}}]})).get("saved-model")!;
it("routes connected pure text models through the revision-bound gateway",()=>{
  const output=nativeModelRequest({projectId:"p",requestId:"r",resource:model(),messages:[{role:"user",content:"Hello"}],maxOutputTokens:32});
  expect(output.call).toBe("provider-model-call");
});
it("forwards accepted Top P to the actual gateway request",()=>{
  const output=nativeModelRequest({projectId:"p",requestId:"r",resource:model({maxOutputTokens:512,topP:0.5} as any),messages:[{role:"user",content:"Hello"}],maxOutputTokens:32});
  expect(output.request).toMatchObject({schemaVersion:"blocky.model-request/v2",topP:0.5});
});
