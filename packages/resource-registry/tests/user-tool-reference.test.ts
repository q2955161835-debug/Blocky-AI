import { expect, it } from "vitest";
import { createAgentExample } from "../../test-fixtures/src/scenarios";
import { referenceUserResource } from "../src";
import { parseProject } from "../../project-model/src";
function resource() {
  return {
    schemaVersion: "blocky.resource/v1alpha1",
    resourceId: "tool-shared",
    kind: "tool",
    scope: "user",
    displayName: "Registered lookup",
    capabilityRequirements: ["network.request"],
    definition: {
      version: "1",
      implementationRef: { kind: "adapter", id: "http-json-v1" },
      permissions: ["network.request"],
      inputSchemaRef: { kind: "schema", id: "schema-tool-shared-input" },
      outputSchemaRef: { kind: "schema", id: "schema-tool-shared-output" },
      inputSchemaJson: '{"type":"string"}',
      outputSchemaJson: '{"type":"integer"}',
      timeoutMs: 3000,
      networkMode: "loopback",
      method: "POST",
    },
    secretBindings: [{ fieldId: "endpoint", secretRef: "lookup-endpoint" }],
  };
}
it("copies a registered tool's public schemas into the project with only a resource reference", () => {
  const original = createAgentExample("tool-reference");
  const project = referenceUserResource(original, resource());
  expect(
    parseProject(project).schemas["schemas/schema-tool-shared-input.json"],
  ).toEqual({ type: "string" });
  expect(project.schemas["schemas/schema-tool-shared-output.json"]).toEqual({
    type: "integer",
  });
  expect(
    original.schemas["schemas/schema-tool-shared-input.json"],
  ).toBeUndefined();
  expect(project.resources["tool-shared"]).toBeUndefined();
  expect(referenceUserResource(project, resource())).toEqual(project);
});
it("refuses conflicting schema identifiers rather than changing other project consumers", () => {
  const project = createAgentExample("tool-reference");
  project.schemas["schemas/schema-tool-shared-input.json"] = { type: "number" };
  expect(() => referenceUserResource(project, resource())).toThrow(
    "BLK-RESOURCE-SCHEMA-CONFLICT",
  );
  expect(project.schemas["schemas/schema-tool-shared-input.json"]).toEqual({
    type: "number",
  });
});
