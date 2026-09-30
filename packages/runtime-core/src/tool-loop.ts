import {
  canonicalJson,
  type Json,
  type Project,
  type Resource,
} from "@blocky/language-schema";
import { resolveResource } from "@blocky/resource-registry";
import { abortable, integer, RunBudget, utf8 } from "./budget";
import {
  checkGeneration,
  checkGenerationMetadata,
  messages,
  type Generation,
  type GenerationRequest,
  type Message,
  type ModelTool,
} from "./agent-context";
import type { Citation } from "./adapters";
import { validateOutput } from "./output-schema";

export type ToolLoopEvent = {
  type:
    | "model.started"
    | "model.completed"
    | "model.failed"
    | "tool.started"
    | "tool.completed"
    | "tool.failed";
  requestId: string;
  data: Record<string, Json>;
};
export type ToolLoopContext = {
  project: Project;
  registry?: Map<string, Resource>;
  model: Resource;
  budget: RunBudget;
  requestId: string;
  question: string;
  role: string;
  instruction: string;
  memory: Json;
  value: Json;
  citations: Citation[];
  requireEvidence: boolean;
  resourceIds: string[];
  maxTurns: number;
  outputPerTurn: number;
  generate(
    request: GenerationRequest,
    signal: AbortSignal,
  ): Promise<Generation>;
  /** The loop owns the call charge. The supplied port retains native authorization. */
  invoke(
    resource: Resource,
    input: Json,
    requestId: string,
    signal: AbortSignal,
  ): Promise<Json>;
  validateCitations?: (signal: AbortSignal) => Promise<void>;
  onGeneration(value: Generation): void;
  onEvent(value: ToolLoopEvent): void;
};
type BoundTool = {
  resource: Resource;
  model: ModelTool;
  input: Json;
  output: Json;
};
function schema(project: Project, resource: Resource, key: string): Json {
  const ref = resource.definition[key];
  if (
    !ref ||
    typeof ref !== "object" ||
    Array.isArray(ref) ||
    ref.kind !== "schema" ||
    typeof ref.id !== "string"
  )
    throw Error("BLK-TOOL-003");
  const value = project.schemas[`schemas/${ref.id}.json`];
  if (!value) throw Error("BLK-TOOL-003");
  return value;
}
function bind(context: ToolLoopContext): BoundTool[] {
  if (
    !context.resourceIds.length ||
    context.resourceIds.length > 16 ||
    new Set(context.resourceIds).size !== context.resourceIds.length
  )
    throw Error("BLK-TOOL-LOOP-CONFIG");
  return context.resourceIds.map((id, index) => {
    const resource = resolveResource(
      context.project,
      id,
      "tool",
      context.registry,
    );
    if (resource.definition.version !== "1") throw Error("BLK-TOOL-003");
    const input = schema(context.project, resource, "inputSchemaRef"),
      output = schema(context.project, resource, "outputSchemaRef");
    return {
      resource,
      input,
      output,
      model: {
        name: `tool_${index + 1}`,
        description: resource.displayName,
        parameters: {
          type: "object",
          properties: { input },
          required: ["input"],
          additionalProperties: false,
        },
      },
    };
  });
}
const code = (error: unknown) =>
  error instanceof Error && /^BLK-[A-Z0-9-]{3,64}$/.test(error.message)
    ? error.message
    : "BLK-TOOL-002";
function historyLimit(history: Message[]): void {
  if (history.length > 128 || utf8(canonicalJson(history)) > 65536)
    throw Error("BLK-CONTEXT-001");
}
/** Model proposals are validated as a whole before any tool in that turn runs. */
export async function runToolLoop(context: ToolLoopContext): Promise<string> {
  const turns = integer(context.maxTurns, 1, 8),
    outputPerTurn = integer(context.outputPerTurn, 1, 4096);
  const tools = bind(context),
    { budget } = context;
  if (context.requireEvidence && !context.citations.length)
    return "资料没有提供足够依据，请补充资料或澄清问题。";
  const history = messages(
    context.role,
    context.instruction,
    context.question,
    context.memory,
    context.value,
    context.citations,
  );
  const ids = new Set<string>(),
    operations = new Set<string>();
  for (let turn = 1; turn <= turns; turn++) {
    budget.check();
    historyLimit(history);
    budget.call();
    const limit = budget.reserveOutput(outputPerTurn),
      requestId = `${context.requestId}-m${turn}`;
    context.onEvent({
      type: "model.started",
      requestId,
      data: { summary: "模型选择下一步", turn, maxOutputTokens: limit },
    });
    let result: Generation;
    try {
      result = await abortable(
        context.generate(
          {
            projectId: context.project.manifest.projectId,
            resource: context.model,
            requestId,
            messages: structuredClone(history),
            maxOutputTokens: limit,
            tools: tools.map((tool) => tool.model),
            toolChoice: turn === turns ? "none" : "auto",
          },
          budget.signal,
        ),
        budget.signal,
      );
      budget.check();
      checkGenerationMetadata(result);
      if (result.usage && result.usage.outputTokens > limit)
        throw Error("BLK-RUN-004");
      context.onGeneration(structuredClone(result));
      context.onEvent({
        type: "model.completed",
        requestId,
        data: {
          summary: "模型已返回下一步",
          turn,
          transport: result.transport,
          model: result.model,
          ...(result.usage ? { usage: result.usage } : {}),
        },
      });
    } catch (error) {
      context.onEvent({
        type: "model.failed",
        requestId,
        data: { summary: "模型决策未完成", code: code(error) },
      });
      throw error;
    }
    if (result.toolCalls !== undefined && !Array.isArray(result.toolCalls))
      throw Error("BLK-TOOL-PROPOSAL");
    const proposed = result.toolCalls ?? [];
    if (!proposed.length) {
      if (
        !result.text.trim() ||
        (result.finishReason !== undefined && result.finishReason !== "stop")
      )
        throw Error("BLK-TOOL-PROPOSAL");
      if (context.validateCitations)
        await abortable(
          context.validateCitations(budget.signal),
          budget.signal,
        );
      checkGeneration(result, context.citations, context.requireEvidence);
      budget.check();
      return result.text;
    }
    if (turn === turns) throw Error("BLK-TOOL-LOOP-LIMIT");
    if (proposed.length > 8 || result.finishReason !== "tool_calls")
      throw Error("BLK-TOOL-PROPOSAL");
    const batchIds = new Set(ids),
      batchOperations = new Set(operations);
    const batch = proposed.map((call) => {
      const tool = tools.find((tool) => tool.model.name === call.name);
      if (
        !tool ||
        typeof call.id !== "string" ||
        !/^[A-Za-z0-9_-]{1,128}$/.test(call.id) ||
        batchIds.has(call.id)
      )
        throw Error("BLK-TOOL-PROPOSAL");
      batchIds.add(call.id);
      validateOutput(call.arguments, tool.model.parameters);
      const input = call.arguments.input;
      const operation = canonicalJson({
        resourceId: tool.resource.resourceId,
        input,
      });
      if (batchOperations.has(operation)) throw Error("BLK-TOOL-DUPLICATE");
      batchOperations.add(operation);
      return { call, tool, input, operation };
    });
    // Reserve the call capacity before a batch starts; a half-executed batch is never retried automatically.
    if (budget.calls + batch.length > budget.maxCalls)
      throw Error("BLK-RUN-004");
    history.push({
      role: "assistant",
      content: result.text,
      toolCalls: structuredClone(proposed),
    });
    for (const [index, item] of batch.entries()) {
      budget.check();
      budget.call();
      ids.add(item.call.id);
      operations.add(item.operation);
      const id = `${context.requestId}-t${turn}-${index + 1}`;
      context.onEvent({
        type: "tool.started",
        requestId: id,
        data: {
          summary: "正在执行模型选择的工具",
          toolId: item.tool.resource.resourceId,
          turn,
          inputBytes: utf8(canonicalJson(item.input)),
        },
      });
      try {
        const value = await abortable(
          context.invoke(item.tool.resource, item.input, id, budget.signal),
          budget.signal,
        );
        budget.check();
        validateOutput(value, item.tool.output);
        const content = canonicalJson(value);
        if (utf8(content) > 32768) throw Error("BLK-TOOL-LIMIT");
        history.push({ role: "tool", content, toolCallId: item.call.id });
        context.onEvent({
          type: "tool.completed",
          requestId: id,
          data: {
            summary: "工具结果已返回",
            toolId: item.tool.resource.resourceId,
            turn,
            outputBytes: utf8(content),
          },
        });
      } catch (error) {
        context.onEvent({
          type: "tool.failed",
          requestId: id,
          data: {
            summary: "工具未完成，未自动重试",
            toolId: item.tool.resource.resourceId,
            code: code(error),
            turn,
          },
        });
        throw error;
      }
    }
  }
  throw Error("BLK-TOOL-LOOP-LIMIT");
}
