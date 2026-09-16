import { expect, it } from "vitest";
import { createStarter } from "../../test-fixtures/src/index";
import {
  analyzeResourceReferences,
  removeProjectResource,
  resourceDefinitions,
  resolveResource,
  upsertProjectResource,
  validateResource,
} from "../src/index";

const definitions: Record<string, object> = {
  model: {
    provider: "openai-compatible",
    baseUrl: "https://api.example.com/v1",
    modelId: "text-model",
    protocol: "openai-chat",
    timeoutMs: 30000,
    capabilities: ["text"],
    parameters: { temperature: 0.5 },
  },
  knowledge: {
    sourceRef: { kind: "resource", id: "documents" },
    chunking: { strategy: "fixed", size: 512, overlap: 64 },
    retrieval: { strategy: "hybrid", topK: 5 },
  },
  memory: {
    type: "conversation",
    sourceRef: { kind: "resource", id: "history" },
    retentionDays: 30,
  },
  tool: {
    version: "1.0.0",
    permissions: ["network.read"],
    implementationRef: { kind: "adapter", id: "fetch-v1" },
  },
  skill: {
    version: "1.0.0",
    permissions: [],
    implementationRef: { kind: "package", id: "summarize" },
  },
  mcp: {
    version: "1.0.0",
    permissions: [],
    implementationRef: { kind: "adapter", id: "mcp-v1" },
    transport: "streamable-http",
    endpoint: "https://mcp.example.com/api",
  },
  guardrail: { stage: "input", policy: "block", rules: ["sensitive-data"] },
  data: { type: "json", sourceRef: { kind: "resource", id: "dataset" } },
  task: {
    version: "1.0.0",
    permissions: [],
    implementationRef: { kind: "task", id: "compile" },
    timeoutMs: 10000,
  },
};
const resource = (kind = "model", definition: object = definitions[kind]) => ({
  schemaVersion: "blocky.resource/v1alpha1",
  resourceId: "sample",
  kind,
  scope: "project",
  displayName: "Sample",
  definition: structuredClone(definition),
  capabilityRequirements: [],
  secretBindings: [],
});

it("validates all nine kinds, exposes serializable schemas and preserves starter adapters", () => {
  expect(resourceDefinitions.map((d) => d.kind).sort()).toEqual(
    Object.keys(definitions).sort(),
  );
  expect(JSON.parse(JSON.stringify(resourceDefinitions))).toEqual(
    resourceDefinitions,
  );
  for (const [kind, definition] of Object.entries(definitions)) {
    expect(validateResource(resource(kind, definition)).kind).toBe(kind);
    expect(() =>
      validateResource(resource(kind, { ...definition, unrecognized: true })),
    ).toThrow();
  }
  for (const value of Object.values(createStarter().resources))
    expect(validateResource(value)).toEqual(value);
  expect(() => validateResource(resource("unknown", {}))).toThrow();
  expect(() => validateResource(resource("model", {}))).toThrow();
});

it("rejects nested secrets, arbitrary headers, shell/path references and invalid configuration", () => {
  for (const definition of [
    { ...definitions.model, apiKey: "not-a-real-key" },
    {
      ...definitions.model,
      parameters: { nested: { token: "not-a-real-token" } },
    },
    { ...definitions.model, headers: {} },
    { ...definitions.model, parameters: { temperature: 4 } },
    { ...definitions.model, timeoutMs: -1 },
    { ...definitions.model, implementationRef: "powershell.exe -command echo" },
  ])
    expect(() => validateResource(resource("model", definition))).toThrow();
  for (const id of ["../file", "C:\\file", "$(shell)", "a;whoami"])
    expect(() =>
      validateResource(
        resource("tool", {
          ...definitions.tool,
          implementationRef: { kind: "adapter", id },
        }),
      ),
    ).toThrow();
});

it("permits only public HTTPS endpoints, with sensitive endpoints represented by secret bindings", () => {
  for (const baseUrl of [
    "http://example.com",
    "https://localhost",
    "https://localhost.example",
    "https://x.localhost",
    "https://127.0.0.1",
    "https://10.0.0.1",
    "https://172.16.0.1",
    "https://192.168.1.1",
    "https://169.254.169.254",
    "https://[::1]",
    "https://[::ffff:127.0.0.1]",
    "https://user:pass@example.com",
    "https://example.com?token=secret",
  ])
    expect(() =>
      validateResource(resource("model", { ...definitions.model, baseUrl })),
    ).toThrow();
  const input = resource();
  delete (input.definition as Record<string, unknown>).baseUrl;
  const bound = {
    ...input,
    secretBindings: [
      { fieldId: "baseUrl", secretRef: "provider-endpoint" },
      { fieldId: "apiKey", secretRef: "provider-key" },
    ],
  };
  expect(validateResource(bound).secretBindings).toHaveLength(2);
  for (const binding of [
    { fieldId: "arbitrary", secretRef: "id" },
    { fieldId: "apiKey", secretRef: "https://private/value" },
    { fieldId: "apiKey", secretRef: "id", value: "secret" },
  ])
    expect(() =>
      validateResource({ ...input, secretBindings: [binding] }),
    ).toThrow();
});

it("upserts and deletes immutably, keeps dangling block references, and reports exact block locations", () => {
  const p = createStarter(),
    before = structuredClone(p);
  const changed = upsertProjectResource(p, resource());
  expect(p).toEqual(before);
  expect(resolveResource(changed, "sample", "model").displayName).toBe(
    "Sample",
  );
  expect(
    changed.manifest.resources.find((r) => r.resourceId === "sample")
      ?.definitionRef,
  ).toBe("resources/sample.json");
  const locations = analyzeResourceReferences(p, "product-handbook");
  expect(locations).toContainEqual({
    moduleId: "citation-service",
    blockId: "lookup-documents",
    fieldId: "RESOURCE",
    resourceId: "product-handbook",
  });
  const removed = removeProjectResource(p, "product-handbook");
  expect(removed.resources["product-handbook"]).toBeUndefined();
  expect(
    removed.manifest.resources.some((r) => r.resourceId === "product-handbook"),
  ).toBe(false);
  expect(removed.workspaces).toEqual(p.workspaces);
  expect(() =>
    resolveResource(removed, "product-handbook", "knowledge"),
  ).toThrow();
  expect(() =>
    upsertProjectResource(p, resource("model", { timeoutMs: -1 })),
  ).toThrow();
  expect(() =>
    upsertProjectResource(p, { ...resource(), scope: "user" }),
  ).toThrow();
  expect(p).toEqual(before);
});

it("never overwrites or falls back across scopes even with the same display name", () => {
  const p = createStarter();
  p.manifest.resources.push({
    resourceId: "sample",
    kind: "model",
    scope: "user",
    definitionRef: "local-model",
    secretRefs: [],
  });
  expect(() => upsertProjectResource(p, resource())).toThrow();
  expect(() => removeProjectResource(p, "sample")).toThrow();
  const local = validateResource({ ...resource(), scope: "user" });
  expect(
    resolveResource(p, "sample", "model", new Map([["local-model", local]])),
  ).toEqual(local);
  expect(() =>
    resolveResource(p, "sample", "model", new Map([["sample", local]])),
  ).toThrow();
});

it("validates every kind's required and constrained fields", () => {
  const invalid: Record<string, object> = {
    model: { ...definitions.model, capabilities: ["arbitrary"] },
    knowledge: {
      ...definitions.knowledge,
      chunking: { strategy: "fixed", size: 10, overlap: 10 },
    },
    memory: { ...definitions.memory, retentionDays: -1 },
    tool: { ...definitions.tool, permissions: ["shell && anything"] },
    skill: { ...definitions.skill, version: 4 },
    mcp: { ...definitions.mcp, endpoint: "https://192.168.1.1" },
    guardrail: { ...definitions.guardrail, policy: "silently-ignore" },
    data: { ...definitions.data, sourceRef: { kind: "path", id: "file" } },
    task: { ...definitions.task, timeoutMs: 0 },
  };
  for (const [kind, definition] of Object.entries(invalid))
    expect(() => validateResource(resource(kind, definition))).toThrow(
      "BLK-RESOURCE-003",
    );
  for (const kind of Object.keys(definitions))
    expect(() => validateResource(resource(kind, {}))).toThrow();
});

it("rejects definitions that smuggle private URLs and secret-like text through ordinary string fields", () => {
  for (const modelId of [
    "https://10.0.0.1/private",
    "Bearer example-secret",
    "sk-not-a-real-key",
  ]) {
    expect(() =>
      validateResource(resource("model", { ...definitions.model, modelId })),
    ).toThrow();
  }
});

it("updating keeps one declaration and updates secret references without aliasing input", () => {
  const p = createStarter();
  const model = {
    ...resource(),
    secretBindings: [{ fieldId: "apiKey", secretRef: "model-key" }],
  };
  const inserted = upsertProjectResource(p, model);
  const changed = upsertProjectResource(inserted, {
    ...model,
    displayName: "Renamed",
  });
  model.secretBindings[0].secretRef = "changed-after-insert";
  expect(
    changed.manifest.resources.filter((r) => r.resourceId === "sample"),
  ).toHaveLength(1);
  expect(
    changed.manifest.resources.find((r) => r.resourceId === "sample")
      ?.secretRefs,
  ).toEqual(["model-key"]);
  expect(inserted.resources.sample.displayName).toBe("Sample");
  expect(changed.resources.sample.displayName).toBe("Renamed");
  const before = structuredClone(changed);
  expect(() => removeProjectResource(changed, "absent")).toThrow();
  expect(() =>
    upsertProjectResource(changed, {
      ...resource("tool"),
      resourceId: "sample",
    }),
  ).toThrow();
  expect(changed).toEqual(before);
});

it("finds references in disabled blocks, shadows and next chains without matching display strings", () => {
  const p = createStarter();
  p.workspaces = {
    nested: {
      blocks: {
        languageVersion: 0,
        blocks: [
          {
            id: "a",
            type: "any",
            fields: { TITLE: "sample" },
            inputs: {
              X: {
                shadow: {
                  id: "b",
                  type: "any",
                  fields: { RESOURCE: "sample" },
                },
              },
            },
            next: {
              block: {
                id: "c",
                type: "any",
                disabled: true,
                fields: { RESOURCE: "sample" },
              },
            },
          },
        ],
      },
    },
  };
  expect(analyzeResourceReferences(p, "sample").map((r) => r.blockId)).toEqual([
    "b",
    "c",
  ]);
});
