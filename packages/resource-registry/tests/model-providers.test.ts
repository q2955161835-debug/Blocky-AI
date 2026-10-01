import { expect, it } from "vitest";
import { createStarter } from "../../test-fixtures/src";
import { modelResource } from "../../../tests/fixtures/model-resource";
import { emptyRegistry, parseRegistry, upsertUserResource, referenceUserResource, resolveResource,
  upsertModelProvider, removeModelProvider, resolveRegistryResources } from "../src";
const provider = (id = "shared", secretRef = "account-one") => ({
  schemaVersion: "blocky.model-provider/v1", providerId: id, displayName: "同一厂商",
  adapter: "xirang", protocol: "openai-chat", revision: 1,
  secretBindings: [{ fieldId: "apiKey", secretRef }],
});
const model = (id: string, connectionRef = "shared") => ({ ...modelResource(id),
  definition: { connectionRef, modelId: id, timeoutMs: 60000, capabilities: ["text"] }, secretBindings: [],
});
it("shares a connection and its edits across two models while retaining model IDs", () => {
  let r = upsertModelProvider(emptyRegistry(), provider());
  r = upsertUserResource(upsertUserResource(r, model("one")), model("two"));
  expect(r.resources.every(m => m.secretBindings.length === 0)).toBe(true);
  const before = resolveRegistryResources(r);
  expect(before.get("one")!.secretBindings).toEqual(provider().secretBindings);
  r = upsertModelProvider(r, { ...provider(), secretBindings: provider("shared", "account-two").secretBindings });
  const after = resolveRegistryResources(r);
  for (const id of ["one", "two"]) {
    expect(after.get(id)!.resourceId).toBe(id);
    expect(after.get(id)!.definition.connectionRevision).toBe(2);
    expect(after.get(id)!.secretBindings[0].secretRef).toBe("account-two");
  }
  expect(() => removeModelProvider(r, "shared")).toThrow("BLK-PROVIDER-IN-USE");
});
it("migrates exact connections without merging same-name different accounts", () => {
  const a = modelResource("a"), b = modelResource("b"), c = modelResource("c");
  c.secretBindings = [{ fieldId: "apiKey", secretRef: "other-account" }];
  const migrated = parseRegistry({ schemaVersion: "blocky.resource-registry/v1", resources: [a, b, c] });
  expect(migrated.providers).toHaveLength(2);
  const map = resolveRegistryResources(migrated);
  expect(map.get("a")!.definition.connectionRef).toBe(map.get("b")!.definition.connectionRef);
  expect(map.get("a")!.definition.connectionRef).not.toBe(map.get("c")!.definition.connectionRef);
  expect(map.get("a")!.definition.modelId).toBe(a.definition.modelId);
  expect(map.get("a")!.secretBindings).toEqual(a.secretBindings);
});
it("preserves portable references and rejects a forged resolved connection marker", () => {
  let r = upsertModelProvider(emptyRegistry(), provider());
  r = upsertUserResource(r, model("one"));
  const map = resolveRegistryResources(r), effective = map.get("one")!;
  const p = referenceUserResource(createStarter(), effective);
  expect(p.manifest.resources.find(x => x.resourceId === "one")!.secretRefs).toEqual([]);
  expect(resolveResource(p, "one", "model", map).secretBindings).toEqual(provider().secretBindings);
  expect(() => resolveResource(p, "one", "model", new Map([["one", structuredClone(effective)]]))).toThrow("BLK-RESOURCE-002");
  const changed = resolveRegistryResources(upsertModelProvider(r, { ...provider(), secretBindings: provider("shared", "account-two").secretBindings }));
  expect(resolveResource(p, "one", "model", changed).resourceId).toBe("one");
});
it("rejects malformed connections, cross-scope bindings, dangling models and duplicate IDs", () => {
  const r = upsertModelProvider(emptyRegistry(), provider());
  for (const bad of [ { ...provider(), protocol: "unknown" }, { ...provider(), baseUrl: "private" },
    { ...provider(), secretBindings: [{ fieldId: "apiKey", secretRef: "sk-forbidden" }] }]) {
    expect(() => upsertModelProvider(r, bad)).toThrow();
  }
  for (const bad of [model("orphan", "missing"), { ...model("project"), scope: "project" },
    { ...model("secret"), secretBindings: provider().secretBindings }]) {
    expect(() => upsertUserResource(r, bad)).toThrow();
  }
  expect(() => parseRegistry({ ...r, providers: [provider(), provider()] })).toThrow();
});
