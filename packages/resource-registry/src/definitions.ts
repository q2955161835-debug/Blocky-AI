/** Serializable field schemas are shared by editors and the runtime validator. */
export type ResourceKind =
  | "model"
  | "knowledge"
  | "memory"
  | "tool"
  | "skill"
  | "mcp"
  | "guardrail"
  | "data"
  | "task";
export type ResourceFieldSchema = {
  type: "string" | "number" | "boolean" | "array" | "object";
  enum?: readonly string[];
  format?: "id" | "public-https" | "implementation-ref";
  minimum?: number;
  maximum?: number;
  integer?: boolean;
  properties?: Record<string, ResourceFieldSchema>;
  required?: readonly string[];
  items?: ResourceFieldSchema;
};
export type ResourceDefinition = {
  schemaVersion: "blocky.resource-definition/v1";
  kind: ResourceKind;
  title: string;
  definitionSchema: ResourceFieldSchema;
  secretFields: readonly string[];
};
const id: ResourceFieldSchema = { type: "string", format: "id" };
const text: ResourceFieldSchema = { type: "string" };
const enumeration = (...values: string[]): ResourceFieldSchema => ({
  type: "string",
  enum: values,
});
const number = (
  minimum: number,
  maximum: number,
  integer = true,
): ResourceFieldSchema => ({ type: "number", minimum, maximum, integer });
const array = (items: ResourceFieldSchema): ResourceFieldSchema => ({
  type: "array",
  items,
});
const object = (
  properties: Record<string, ResourceFieldSchema>,
  required: string[] = [],
): ResourceFieldSchema => ({ type: "object", properties, required });
const reference = object(
  { kind: enumeration("resource", "artifact", "schema"), id },
  ["kind", "id"],
);
const implementation: ResourceFieldSchema = {
  type: "object",
  format: "implementation-ref",
  properties: { kind: enumeration("adapter", "package", "task"), id },
  required: ["kind", "id"],
};
const https: ResourceFieldSchema = { type: "string", format: "public-https" };
const executable = {
  version: text,
  permissions: array(id),
  implementationRef: implementation,
};
const definition = (
  kind: ResourceKind,
  title: string,
  definitionSchema: ResourceFieldSchema,
  secretFields: string[] = ["access"],
): ResourceDefinition => ({
  schemaVersion: "blocky.resource-definition/v1",
  kind,
  title,
  definitionSchema,
  secretFields,
});

export const resourceDefinitions: readonly ResourceDefinition[] = [
  definition(
    "model",
    "模型",
    object(
      {
        provider: id,
        baseUrl: https,
        modelId: text,
        protocol: enumeration(
          "openai-chat",
          "openai-responses",
          "native",
          "local",
        ),
        timeoutMs: number(1, 3600000),
        capabilities: array(
          enumeration(
            "text",
            "image",
            "audio",
            "tools",
            "structured-output",
            "embedding",
          ),
        ),
        parameters: object({
          temperature: number(0, 2, false),
          topP: number(0, 1, false),
          maxOutputTokens: number(1, 10000000),
          retries: number(0, 10),
          concurrency: number(1, 128),
          contextLength: number(1, 10000000),
        }),
        implementationRef: implementation,
      },
      ["provider", "modelId", "protocol", "timeoutMs", "capabilities"],
    ),
    ["apiKey", "baseUrl", "authorization", "headers", "proxy"],
  ),
  definition(
    "knowledge",
    "知识库",
    object(
      {
        collection: id,
        implementationRef: implementation,
        sourceRef: reference,
        sourceRefs: array(reference),
        chunking: object(
          {
            strategy: enumeration("fixed", "paragraph", "semantic"),
            size: number(1, 1000000),
            overlap: number(0, 999999),
          },
          ["strategy", "size", "overlap"],
        ),
        index: object(
          {
            strategy: enumeration("keyword", "vector", "hybrid"),
            embeddingResourceId: id,
          },
          ["strategy"],
        ),
        retrieval: object(
          {
            strategy: enumeration("keyword", "vector", "hybrid"),
            topK: number(1, 20),
            rerankResourceId: id,
            maxCandidates: number(1, 200),
            minScore: number(0, 1, false),
            contextBudget: number(64, 64000),
            rerank: { type: "boolean" },
            timeoutMs: number(50, 120000),
            fallback: enumeration("error", "keyword"),
            modelId: id,
            filters: array(
              object({ key: text, value: text }, ["key", "value"]),
            ),
          },
          ["strategy", "topK"],
        ),
      },
      ["chunking", "retrieval"],
    ),
  ),
  definition(
    "memory",
    "记忆",
    object(
      {
        type: enumeration("conversation", "key-value", "episodic"),
        sourceRef: reference,
        retentionDays: number(0, 36500),
      },
      ["type", "sourceRef"],
    ),
  ),
  definition(
    "tool",
    "工具",
    object(
      { ...executable, inputSchemaRef: reference, outputSchemaRef: reference },
      ["version", "permissions", "implementationRef"],
    ),
  ),
  definition(
    "skill",
    "技能",
    object({ ...executable, sourceRef: reference, contentDigest: text }, [
      "version",
      "permissions",
      "implementationRef",
    ]),
  ),
  definition(
    "mcp",
    "MCP",
    object(
      {
        ...executable,
        transport: enumeration("stdio", "streamable-http", "sse"),
        endpoint: https,
        tools: array(id),
      },
      ["version", "permissions", "implementationRef", "transport"],
    ),
    ["endpoint", "authorization", "headers", "access"],
  ),
  definition(
    "guardrail",
    "护栏",
    object(
      {
        stage: enumeration("input", "output", "both"),
        policy: enumeration("block", "warn", "redact"),
        rules: array(id),
      },
      ["stage", "policy", "rules"],
    ),
  ),
  definition(
    "data",
    "数据",
    object(
      {
        type: enumeration("json", "text", "table", "binary"),
        sourceRef: reference,
        schemaRef: reference,
      },
      ["type", "sourceRef"],
    ),
  ),
  definition(
    "task",
    "任务",
    object(
      {
        ...executable,
        timeoutMs: number(1, 3600000),
        inputSchemaRef: reference,
        outputSchemaRef: reference,
      },
      ["version", "permissions", "implementationRef"],
    ),
  ),
];
