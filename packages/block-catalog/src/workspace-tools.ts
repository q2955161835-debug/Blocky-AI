import type { Json, Project, Resource } from "@blocky/language-schema";

const path: Json = { type: "string", maxLength: 500 };
const object = (properties: Record<string, Json>, required: string[] = []): Json =>
  ({ type: "object", properties, required, additionalProperties: false });
export const workspaceToolDefinitions = [
  { operation: "list", name: "列出工作目录文件与可撤销变更编号", permission: "workspace.read", input: object({ path }) },
  { operation: "search", name: "搜索工作目录文本", permission: "workspace.read", input: object({ query: { type: "string", maxLength: 200 }, path }, ["query"]) },
  { operation: "read", name: "读取文件与版本摘要", permission: "workspace.read", input: object({ path }, ["path"]) },
  { operation: "write", name: "创建或修改文件并返回差异", permission: "workspace.write", input: object({ path, text: { type: "string", maxLength: 16000 }, expectedDigest: { type: "string", maxLength: 64, description: "新建文件使用空字符串；修改已有文件使用读取工具返回的最新 digest" } }, ["path", "text", "expectedDigest"]) },
  { operation: "undo", name: "按变更回执撤销文件修改", permission: "workspace.write", input: object({ changeId: { type: "string", maxLength: 200 } }, ["changeId"]) },
  { operation: "check", name: "检查 JSON 或 JavaScript 语法，返回实际结果", permission: "workspace.check", input: object({ path, kind: { type: "string", enum: ["json", "javascript"] } }, ["path", "kind"]) },
] as const;

/** Declarative project resources only; native directory grants never enter the project. */
export function workspaceToolResources(project: Project, operations: readonly string[]): string[] {
  return operations.map((operation) => {
    const tool = workspaceToolDefinitions.find((entry) => entry.operation === operation);
    if (!tool) throw Error("BLK-TOOL-003");
    const resourceId = `workspace-${operation}`;
    const inputId = `${resourceId}-input`, outputId = `${resourceId}-output`;
    project.schemas[`schemas/${inputId}.json`] = structuredClone(tool.input);
    const output: Json = { type: "object" };
    project.schemas[`schemas/${outputId}.json`] = output;
    const resource: Resource = {
      schemaVersion: "blocky.resource/v1alpha1", resourceId, displayName: tool.name,
      kind: "tool", scope: "project", secretBindings: [], capabilityRequirements: [tool.permission],
      definition: {
        version: "1", permissions: [tool.permission], implementationRef: { kind: "adapter", id: "workspace-file-v1" }, operation,
        inputSchemaRef: { kind: "schema", id: inputId }, outputSchemaRef: { kind: "schema", id: outputId },
        inputSchemaJson: JSON.stringify(tool.input), outputSchemaJson: JSON.stringify(output), timeoutMs: 30000,
      },
    };
    project.resources[resourceId] = resource;
    project.manifest.resources.push({ resourceId, kind: "tool", scope: "project", definitionRef: `resources/${resourceId}.json`, secretRefs: [] });
    return resourceId;
  });
}
