import { z } from "zod";

const bytes = (value: unknown) =>
  Buffer.byteLength(JSON.stringify(value), "utf8");
const text = (max: number, min = 0) =>
  z
    .string()
    .min(min)
    .max(max)
    .refine((s) => Buffer.byteLength(s, "utf8") <= max);
export const modelIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/);
const token = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .regex(/^[A-Za-z0-9_-]+$/);

const schemaShape = z
  .object({
    type: z.enum([
      "object",
      "array",
      "string",
      "number",
      "integer",
      "boolean",
      "null",
    ]),
    properties: z.record(text(128, 1).refine((s) => !/[\u0000-\u001f\u007f-\u009f]/u.test(s)), z.json()).optional(),
    required: z.array(z.string()).max(64).optional(),
    additionalProperties: z.boolean().optional(),
    items: z.json().optional(),
    enum: z.array(z.json()).min(1).max(128).optional(),
    minimum: z.number().optional(),
    maximum: z.number().optional(),
    minLength: z.number().int().min(0).max(65536).optional(),
    maxLength: z.number().int().min(0).max(65536).optional(),
    minItems: z.number().int().min(0).max(65536).optional(),
    maxItems: z.number().int().min(0).max(65536).optional(),
    description: text(2048).optional(),
  })
  .strict();
function validSchema(value: unknown, depth = 0): boolean {
  const result = schemaShape.safeParse(value);
  if (!result.success || depth > 8 || bytes(value) > 16384) return false;
  const s = result.data;
  if (
    s.properties &&
    (s.type !== "object" ||
      Object.keys(s.properties).length > 64 ||
      Object.values(s.properties).some((v) => !validSchema(v, depth + 1)))
  )
    return false;
  if (
    s.items !== undefined &&
    (s.type !== "array" || !validSchema(s.items, depth + 1))
  )
    return false;
  if (
    s.required &&
    (new Set(s.required).size !== s.required.length ||
      s.required.some((key) => !Object.hasOwn(s.properties ?? {}, key)))
  )
    return false;
  return true;
}
export const modelOutputSchema = schemaShape.refine(
  validSchema,
  "使用有界 JSON Schema 子集；不支持引用或外部资源。",
);
export const modelToolCallSchema = z
  .object({
    id: token(128),
    name: token(64),
    arguments: z.record(z.string(), z.json()).refine((v) => bytes(v) <= 32768),
  })
  .strict();
const messageSchema = z
  .object({
    role: z.enum(["system", "user", "assistant", "tool"]),
    content: text(65536),
    toolCalls: modelToolCallSchema.array().max(8).optional(),
    toolCallId: token(128).optional(),
    imageRefs:z.array(z.object({mediaId:modelIdSchema,sha256:z.string().regex(/^[a-f0-9]{64}$/),version:z.number().int().positive().max(Number.MAX_SAFE_INTEGER)}).strict()).max(4).optional(),
  })
  .strict();
const toolSchema = z
  .object({
    name: token(64),
    description: text(2048, 1),
    parameters: modelOutputSchema.refine((s) => s.type === "object"),
  })
  .strict();

/** Shared shapes power CLI validation and schema discovery; Host remains authoritative. */
export const modelRequestSchema = z
  .object({
    schemaVersion: z.literal("blocky.model-request/v2"),
    requestId: modelIdSchema,
    projectId: modelIdSchema,
    resourceId: modelIdSchema,
    messages: messageSchema.array().min(1).max(128),
    tools: toolSchema.array().max(32).optional(),
    maxOutputTokens: z.number().int().min(1).max(32768),
    timeoutMs: z.number().int().min(1).max(120000),
    temperature: z.number().min(0).max(2).optional(),
    outputSchema: modelOutputSchema.optional(),
    toolChoice: z.enum(["auto", "required", "none"]).optional(),
  })
  .strict()
  .superRefine((r, ctx) => {
    const fail = (path: (string | number)[]) =>
      ctx.addIssue({
        code: "custom",
        path,
        message: "模型请求结构或工具历史无效。",
      });
    if (bytes(r) > 262144) fail([]);
    const names = new Set((r.tools ?? []).map((t) => t.name));
    if (
      names.size !== (r.tools ?? []).length ||
      (r.toolChoice !== undefined && r.toolChoice !== "none" && !names.size)
    )
      fail(["tools"]);
    const used = new Set<string>(),
      pending = new Set<string>();
    r.messages.forEach((m, index) => {
      if((m.imageRefs?.length??0)>0&&m.role!=='user')fail(['messages',index,'imageRefs']);
      const calls = m.toolCalls ?? [];
      if (m.role === "system" || m.role === "user") {
        if (
          pending.size ||
          calls.length ||
          m.toolCallId !== undefined ||
          !m.content ||
          (m.role === "system" && index !== 0)
        )
          fail(["messages", index]);
      } else if (m.role === "assistant") {
        if (
          pending.size ||
          m.toolCallId !== undefined ||
          (!m.content && !calls.length)
        )
          fail(["messages", index]);
        for (const call of calls) {
          if (used.has(call.id) || !names.has(call.name))
            fail(["messages", index, "toolCalls"]);
          used.add(call.id);
          pending.add(call.id);
        }
      } else if (
        calls.length ||
        m.toolCallId === undefined ||
        !pending.delete(m.toolCallId)
      )
        fail(["messages", index]);
    });
    if (pending.size) fail(["messages"]);
    if(r.messages.reduce((sum,m)=>sum+(m.imageRefs?.length??0),0)>4)fail(['messages']);
  });

const usageSchema = z
  .object({
    inputTokens: z.number().int().min(0).max(10000000),
    outputTokens: z.number().int().min(0).max(32768),
    totalTokens: z.number().int().min(0).max(10032768),
  })
  .strict();
const metadata = text(256, 1).refine((s) => !/[\u0000-\u001f\u007f]/.test(s));
export const modelResponseSchema = z
  .object({
    schemaVersion: z.literal("blocky.model-response/v2"),
    text: text(65536),
    toolCalls: modelToolCallSchema.array().max(8),
    finishReason: z.enum(["stop", "tool_calls"]),
    model: metadata.max(128),
    requestId: metadata,
    provider: text(128, 1),
    transport: z.enum(["remote", "local"]),
    usageStatus: z.enum(["reported", "unavailable"]),
    usage: usageSchema.nullable(),
    localInference: z.boolean().optional(),
    externalApi: z.boolean().optional(),
    modelApiCalled: z.boolean().optional(),
  })
  .strict()
  .superRefine((r, ctx) => {
    if (
      (r.modelApiCalled !== undefined &&
        r.modelApiCalled !== (r.transport === "remote")) ||
      (r.finishReason === "tool_calls") !== !!r.toolCalls.length ||
      (!r.text && !r.toolCalls.length) ||
      new Set(r.toolCalls.map((c) => c.id)).size !== r.toolCalls.length ||
      (r.usageStatus === "reported") !== (r.usage !== null) ||
      (r.usage &&
        r.usage.inputTokens + r.usage.outputTokens !== r.usage.totalTokens) ||
      bytes(r) > 262144
    )
      ctx.addIssue({ code: "custom", message: "模型响应或用量不一致。" });
  });
