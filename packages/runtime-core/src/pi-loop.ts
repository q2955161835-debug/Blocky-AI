import { Agent, type AgentTool, type StreamFn } from "@earendil-works/pi-agent-core";
import { createAssistantMessageEventStream, type AssistantMessage, type Message as PiMessage, type Model, type JsonObject } from "@earendil-works/pi-ai";
import type { TSchema } from "typebox";
import { canonicalJson, type Json } from "@blocky/language-schema";
import { bindLoopTools, type ToolLoopContext } from "./tool-loop";
import { abortable, integer, utf8 } from "./budget";
import { messages, checkGeneration, checkGenerationMetadata, type Message } from "./agent-context";
import { validateOutput } from "./output-schema";

export type PiConversation = { role: "user" | "assistant"; content: string }[];
const errorCode = (error: unknown) => error instanceof Error && /^BLK-[A-Z0-9-]{3,64}$/.test(error.message) ? error.message : "BLK-TOOL-002";
const emptyUsage = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } });
function wire(messages: PiMessage[]): Message[] {
  return messages.map((m): Message => {
    if (m.role === "system") return { role: "system", content: [typeof m.content === "string" ? m.content : m.content.map((c) => c.text).join("\n"), ...Object.values(m.sections ?? {}).filter(Boolean)].join("\n") };
    if (m.role === "user") return { role: "user", content: typeof m.content === "string" ? m.content : m.content.filter((c) => c.type === "text").map((c) => c.text).join("\n") };
    if (m.role === "toolResult") return { role: "tool", toolCallId: m.toolCallId, content: m.content.filter((c) => c.type === "text").map((c) => c.text).join("\n") };
    return { role: "assistant", content: m.content.filter((c) => c.type === "text").map((c) => c.text).join("\n"), toolCalls: m.content.flatMap((c) => c.type === "toolCall" ? [{ id: c.id, name: c.name, arguments: c.arguments as Record<string, Json> }] : []) };
  });
}

/** Official Pi owns the turn loop and dispatch. Host ports retain credentials, permissions and side effects. */
export async function runPiLoop(context: ToolLoopContext, conversation: PiConversation = []): Promise<string> {
  const { budget } = context, turns = integer(context.maxTurns, 1, 8), outputPerTurn = integer(context.outputPerTurn, 1, 4096);
  const bound = bindLoopTools(context, true);
  if (conversation.length > 20 || utf8(canonicalJson(conversation)) > 16000 || conversation.some((m) => !["user", "assistant"].includes(m.role) || typeof m.content !== "string")) throw Error("BLK-CONTEXT-001");
  if (context.requireEvidence && !context.citations.length) return "资料没有提供足够依据，请补充资料或澄清问题。";
  const initial = messages(context.role, context.instruction, context.question, context.memory, context.value, context.citations);
  const model: Model<"blocky-host"> = { id: context.model.resourceId, name: context.model.displayName, api: "blocky-host", provider: "blocky-host", baseUrl: "", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 131072, maxTokens: outputPerTurn };
  let turn = 0, toolSequence = 0, answer = "", failure: unknown;
  const ids = new Set<string>(), operations = new Set<string>();
  const tools: AgentTool[] = bound.map((tool) => ({
    name: tool.model.name, label: tool.resource.displayName, description: tool.model.description,
    parameters: tool.model.parameters as unknown as TSchema, executionMode: "sequential", replay: "never",
    async execute(callId, args) {
      budget.check();
      if (failure) throw failure;
      budget.call();
      // Provider call IDs may contain uppercase letters; native request IDs are
      // locally generated stable identifiers, while Pi keeps the original ID.
      const requestId = `${context.requestId}-t${turn}-${++toolSequence}`;
      context.onEvent({ type: "tool.started", requestId, data: { summary: "Pi 正在执行工具", engine: "pi-agent-core/0.86.0", toolId: tool.resource.resourceId, turn } });
      try {
        validateOutput(args as Json, tool.model.parameters);
        const input = (args as { input: Json }).input;
        const value = await abortable(context.invoke(tool.resource, input, requestId, budget.signal), budget.signal);
        budget.check(); validateOutput(value, tool.output);
        const content = canonicalJson(value);
        if (utf8(content) > 32768) throw Error("BLK-TOOL-LIMIT");
        context.onEvent({ type: "tool.completed", requestId, data: { summary: "工具结果已返回 Pi", toolId: tool.resource.resourceId, turn, outputBytes: utf8(content) } });
        return { content: [{ type: "text", text: content }], details: null };
      } catch (error) {
        failure = error;
        context.onEvent({ type: "tool.failed", requestId, data: { summary: "工具未完成", toolId: tool.resource.resourceId, turn, code: errorCode(error) } });
        throw error;
      }
    },
  }));
  const streamFn: StreamFn = (_model, piContext) => {
    const stream = createAssistantMessageEventStream();
    const output: AssistantMessage = { role: "assistant", content: [], api: model.api, provider: model.provider, model: model.id, usage: emptyUsage(), stopReason: "pending", timestamp: Date.now() };
    void (async () => {
      let requestId = context.requestId;
      try {
        if (failure) throw failure;
        budget.check();
        if (++turn > turns) throw Error("BLK-TOOL-LOOP-LIMIT");
        const history = wire(piContext.messages);
        if (history.length > 128 || utf8(canonicalJson(history)) > 65536) throw Error("BLK-CONTEXT-001");
        budget.call(); const limit = budget.reserveOutput(outputPerTurn);
        requestId = `${context.requestId}-m${turn}`;
        context.onEvent({ type: "model.started", requestId, data: { summary: "Pi 模型选择下一步", engine: "pi-agent-core/0.86.0", turn, maxOutputTokens: limit } });
        const result = await abortable(context.generate({ projectId: context.project.manifest.projectId, resource: context.model, requestId, messages: history, maxOutputTokens: limit, tools: bound.map((t) => t.model), toolChoice: !bound.length || turn === turns ? "none" : "auto" }, budget.signal), budget.signal);
        budget.check(); checkGenerationMetadata(result);
        if (result.usage && result.usage.outputTokens > limit) throw Error("BLK-RUN-004");
        context.onGeneration(structuredClone(result));
        if (result.toolCalls !== undefined && !Array.isArray(result.toolCalls)) throw Error("BLK-TOOL-PROPOSAL");
        const proposed = result.toolCalls ?? [];
        if (proposed.length) {
          if (turn === turns) throw Error("BLK-TOOL-LOOP-LIMIT");
          if (proposed.length > 8 || result.finishReason !== "tool_calls") throw Error("BLK-TOOL-PROPOSAL");
          const batchIds = new Set(ids), batchOperations = new Set(operations);
          // Validate the complete proposal before the SDK observes any tool call.
          for (const call of proposed) {
            const tool = bound.find((t) => t.model.name === call?.name);
            if (!tool || typeof call.id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(call.id) || batchIds.has(call.id)) throw Error("BLK-TOOL-PROPOSAL");
            validateOutput(call.arguments, tool.model.parameters);
            const operation = canonicalJson({ resourceId: tool.resource.resourceId, input: call.arguments.input });
            if (batchOperations.has(operation)) throw Error("BLK-TOOL-DUPLICATE");
            batchIds.add(call.id); batchOperations.add(operation);
          }
          if (budget.calls + proposed.length > budget.maxCalls) throw Error("BLK-RUN-004");
          batchIds.forEach((id) => ids.add(id)); batchOperations.forEach((op) => operations.add(op));
        } else {
          if (!result.text.trim() || (result.finishReason !== undefined && result.finishReason !== "stop")) throw Error("BLK-TOOL-PROPOSAL");
          if (context.validateCitations) await abortable(context.validateCitations(budget.signal), budget.signal);
          checkGeneration(result, context.citations, context.requireEvidence); budget.check(); answer = result.text;
        }
        context.onEvent({ type: "model.completed", requestId, data: { summary: "Pi 模型已返回", engine: "pi-agent-core/0.86.0", turn, transport: result.transport, model: result.model, ...(result.usage ? { usage: result.usage } : {}) } });
        if (result.text) output.content.push({ type: "text", text: result.text });
        for (const call of proposed) output.content.push({ type: "toolCall", id: call.id, name: call.name, arguments: call.arguments as JsonObject });
        if (result.usage) Object.assign(output.usage, { input: result.usage.inputTokens, output: result.usage.outputTokens, totalTokens: result.usage.totalTokens });
        output.responseId = result.requestId; output.responseModel = result.model;
        output.stopReason = proposed.length ? "toolUse" : "stop";
        stream.push({ type: "start", partial: output });
        stream.push({ type: "done", reason: output.stopReason, message: output });
      } catch (error) {
        failure = error;
        context.onEvent({ type: "model.failed", requestId, data: { summary: "Pi 模型决策未完成", code: errorCode(error), engine: "pi-agent-core/0.86.0" } });
        output.stopReason = budget.signal.aborted ? "aborted" : "error"; output.errorMessage = errorCode(error);
        stream.push({ type: "error", reason: output.stopReason, error: output });
      }
    })();
    return stream;
  };
  const agent = new Agent({ initialState: { systemPrompt: initial[0].content, model, tools }, streamFn, toolExecution: "sequential",
    beforeToolCall: async () => failure ? { block: true, terminate: true, reason: errorCode(failure) } : undefined,
    shouldStopAfterTurn: () => !!failure,
  });
  agent.state.messages = [...agent.state.messages, ...conversation.map((m): PiMessage => m.role === "user" ? { role: "user", content: m.content, timestamp: Date.now() } : { role: "assistant", content: [{ type: "text", text: m.content }], api: model.api, provider: model.provider, model: model.id, usage: emptyUsage(), stopReason: "stop", timestamp: Date.now() })];
  const abort = () => agent.abort(); budget.signal.addEventListener("abort", abort, { once: true });
  try {
    budget.check(); await abortable(agent.prompt(initial[1].content), budget.signal);
    if (failure) throw failure;
    budget.check(); if (!answer) throw Error("BLK-TOOL-PROPOSAL");
    return answer;
  } finally { budget.signal.removeEventListener("abort", abort); agent.abort(); }
}
