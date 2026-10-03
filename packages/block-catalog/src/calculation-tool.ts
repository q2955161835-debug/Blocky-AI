import type { Json, Project, Resource } from "@blocky/language-schema";

/** Pure numeric tool; it accepts operands, never source code or an expression. */
export function calculationToolResource(project: Project): string {
  const resourceId = "work-calculator",
    inputId = "work-calculator-input",
    outputId = "work-calculator-output";
  const input: Json = {
    type: "object",
    properties: {
      operation: {
        type: "string",
        enum: ["add", "subtract", "multiply", "divide"],
      },
      values: {
        type: "array",
        items: { type: "number" },
        maxItems: 100,
        description: "至少两个有限数值；不足两个由计算服务拒绝",
      },
    },
    required: ["operation", "values"],
    additionalProperties: false,
  };
  const output: Json = {
    type: "object",
    properties: { operation: { type: "string" }, result: { type: "number" } },
    required: ["operation", "result"],
    additionalProperties: false,
  };
  project.schemas[`schemas/${inputId}.json`] = input;
  project.schemas[`schemas/${outputId}.json`] = output;
  const resource: Resource = {
    schemaVersion: "blocky.resource/v1alpha1",
    resourceId,
    displayName: "计算并核验数字：加减乘除，返回确定性结果",
    kind: "tool",
    scope: "project",
    secretBindings: [],
    capabilityRequirements: ["data.calculate"],
    definition: {
      version: "1",
      permissions: ["data.calculate"],
      implementationRef: { kind: "adapter", id: "arithmetic-v1" },
      inputSchemaRef: { kind: "schema", id: inputId },
      outputSchemaRef: { kind: "schema", id: outputId },
      inputSchemaJson: JSON.stringify(input),
      outputSchemaJson: JSON.stringify(output),
      timeoutMs: 1000,
    },
  };
  project.resources[resourceId] = resource;
  project.manifest.resources.push({
    resourceId,
    kind: "tool",
    scope: "project",
    definitionRef: `resources/${resourceId}.json`,
    secretRefs: [],
  });
  return resourceId;
}
