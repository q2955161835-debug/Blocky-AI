import type {
  Project,
  Resource,
  WorkspaceBlock,
} from "@blocky/language-schema";
import { projectShell, moduleDescriptor, mainRoot } from "./shared";
/** A complete Agent project used only as deterministic test input. */
export function createAgentExample(
  projectId = `project-${crypto.randomUUID()}`,
): Project {
  const p = projectShell(projectId, "文本分析 Agent");
  p.manifest.format.minimumReaderVersion = "0.4.0";
  const model: Resource = {
    schemaVersion: "blocky.resource/v1alpha1",
    resourceId: "agent-model",
    kind: "model",
    scope: "project",
    displayName: "本地整理",
    definition: {
      provider: "deterministic",
      modelId: "generator-v1",
      protocol: "local",
      timeoutMs: 30000,
      capabilities: ["text"],
      parameters: { maxOutputTokens: 1024 },
      implementationRef: { kind: "adapter", id: "generator-v1" },
    },
    capabilityRequirements: [],
    secretBindings: [],
  };
  const tool: Resource = {
    schemaVersion: "blocky.resource/v1alpha1",
    resourceId: "text-tool",
    kind: "tool",
    scope: "project",
    displayName: "文本统计",
    definition: {
      version: "1",
      permissions: ["text.analyze"],
      implementationRef: { kind: "adapter", id: "text-analyze-v1" },
      inputSchemaRef: { kind: "schema", id: "text-input" },
      outputSchemaRef: { kind: "schema", id: "text-result" },
    },
    capabilityRequirements: ["text.analyze"],
    secretBindings: [],
  };
  p.resources = { [model.resourceId]: model, [tool.resourceId]: tool };
  p.manifest.resources = [model, tool].map((r) => ({
    resourceId: r.resourceId,
    kind: r.kind,
    scope: r.scope,
    definitionRef: `resources/${r.resourceId}.json`,
    secretRefs: [],
  }));
  p.schemas = {
    "schemas/text-input.json": { type: "string", maxLength: 16000 },
    "schemas/text-result.json": {
      type: "object",
      properties: {
        characters: { type: "integer", minimum: 0 },
        lines: { type: "integer", minimum: 0 },
        words: { type: "integer", minimum: 0 },
      },
      required: ["characters", "lines", "words"],
      additionalProperties: false,
    },
  };
  p.manifest.modules = [
    moduleDescriptor(
      "research-agent",
      "文本分析",
      "agent",
      "analyze",
      "agent",
      "schemas/text-input.json",
      "schemas/text-result.json",
    ),
  ];
  const blocks: WorkspaceBlock[] = [
    {
      type: "core.run.budget",
      id: "run-budget",
      fields: {
        STEPS: "100",
        CALLS: "8",
        OUTPUT_TOKENS: "1024",
        TIMEOUT_MS: "120000",
      },
    },
    {
      type: "core.prompt.context",
      id: "instruction",
      fields: {
        TEXT: "解释本机文本统计的结果。不得声称已经修改文件或查询网络。",
      },
    },
    {
      type: "core.memory.write",
      id: "remember-input",
      fields: { KEY: "last-input", SCOPE: "session", SOURCE: "input" },
    },
    {
      type: "core.tool.invoke",
      id: "analyze-text",
      fields: { RESOURCE: "text-tool", SOURCE: "input" },
    },
    {
      type: "core.output.structured",
      id: "structured-result",
      fields: { SCHEMA: "schemas/text-result.json" },
    },
    {
      type: "core.output.file",
      id: "file-result",
      fields: { NAME: "文本统计.json", FORMAT: "json" },
    },
    {
      type: "core.model.compose",
      id: "compose-answer",
      fields: { RESOURCE: "agent-model" },
    },
    {
      type: "core.output.answer",
      id: "reply-answer",
      fields: { STYLE: "段落" },
    },
  ];
  blocks.forEach((b, i) => {
    if (blocks[i + 1]) b.next = { block: blocks[i + 1] };
  });
  p.workspaces["research-agent"] = {
    blocks: {
      languageVersion: 0,
      blocks: [mainRoot("你是文本分析助手。", "输入待统计的文字", blocks[0])],
    },
  };
  return p;
}
