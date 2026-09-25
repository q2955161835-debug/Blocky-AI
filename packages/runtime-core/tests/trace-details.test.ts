import { expect, it } from "vitest";
import { TraceSession, inspectTraceExport } from "@blocky/observability";
import type { WorkspaceBlock } from "@blocky/language-schema";
import { createStarter } from "../../test-fixtures/src";
import { Runtime, localAdapters } from "../src";
import { createAgentExample } from "../../block-catalog/src/agent-example";

function project(...blocks: WorkspaceBlock[]) {
  const p = createStarter();
  blocks.forEach((block, i) => { if (blocks[i + 1]) block.next = { block: blocks[i + 1] }; });
  p.workspaces["research-agent"].blocks.blocks[0].inputs!.BODY.block!.next = { block: blocks[0] };
  p.resources["local-composer"].definition = {
    provider: "deterministic", modelId: "generator-v1", protocol: "local", timeoutMs: 1000,
    capabilities: ["text"], implementationRef: { kind: "adapter", id: "generator-v1" },
  };
  return p;
}
it("projects real memory, context and no-evidence decisions without leaking values or reusing earlier generation metadata", async () => {
  const p = project(
    { type: "core.memory.write", id: "remember", fields: { KEY: "private-note", SCOPE: "session", SOURCE: "input" } },
    { type: "core.memory.read", id: "recall", fields: { KEY: "private-note", SCOPE: "session" } },
    { type: "core.model.compose", id: "first-model", fields: { RESOURCE: "local-composer" } },
    { type: "core.guardrail.evidence", id: "guard", fields: { POLICY: "require" } },
    { type: "core.model.compose", id: "second-model", fields: { RESOURCE: "local-composer" } },
  );
  const result = await new Runtime().run(p, "on-question", "PRIVATE_INPUT_BODY");
  expect(result.status, JSON.stringify(result.events.filter(e => e.type.endsWith("failed")))).toBe("completed");
  const trace = new TraceSession(); result.events.forEach(e => trace.add(e));
  const frames = inspectTraceExport(trace.export()).frames;
  expect(frames.find(f => f.blockId === "recall" && f.type === "block.completed")?.details?.memory).toEqual({ action: "read", scope: "session" });
  const first = frames.find(f => f.blockId === "first-model" && f.type === "model.completed")!;
  expect(first.details?.model?.maxOutputTokens).toBe(1024);
  expect(first.details?.context?.userBytes).toBe(18);
  expect(first.details?.guard?.decision).toBe("passed");
  const second = frames.find(f => f.blockId === "second-model" && f.type === "model.completed")!;
  expect(second.details?.guard?.decision).toBe("insufficient-evidence");
  expect(second.model).toBeUndefined();
  expect(second.details?.model).toBeUndefined();
  expect(JSON.stringify(trace.export())).not.toMatch(/PRIVATE_INPUT_BODY|private-note/);
  expect(result.modelApiCalled).toBe(false);
});

it("records tool argument and result shapes from execution without storing tool contents", async () => {
  const adapters = localAdapters();
  adapters.agent = { tool: async () => ({ characters: 7, words: 1, lines: 1 }) };
  const result = await new Runtime({ adapters, capabilities: ["text.analyze"] }).run(createAgentExample(), "on-question", "PRIVATE_TOOL_INPUT");
  expect(result.status, JSON.stringify(result.events.filter(e => e.type.endsWith("failed")))).toBe("completed");
  const trace = new TraceSession(); result.events.forEach(e => trace.add(e));
  expect(trace.list().find(f => f.type === "tool.completed")?.details?.tool).toEqual({
    source: "input", inputType: "string", inputBytes: 20, outputType: "object", outputBytes: 36,
  });
  expect(JSON.stringify(trace.export())).not.toContain("PRIVATE_TOOL_INPUT");
});

it("counts only the evidence fields actually included in model context", async () => {
  const p = project(
    { type: "core.knowledge.retrieve", id: "retrieve", fields: { RESOURCE: "product-handbook" } },
    { type: "core.model.compose", id: "compose", fields: { RESOURCE: "local-composer" } },
  );
  const evidence = { id: "source-1", title: "标题", text: "证据正文" };
  const adapters = localAdapters();
  adapters.knowledge.set("adapter://deterministic/knowledge-v1", async () => [{ ...evidence, sourceId: "private-source-" + "x".repeat(1000) }]);
  const result = await new Runtime({ adapters }).run(p, "on-question", "query");
  expect(result.status).toBe("completed");
  const trace = new TraceSession(); result.events.forEach(e => trace.add(e));
  expect(trace.list().find(f => f.type === "model.completed")?.details?.context?.evidenceBytes)
    .toBe(new TextEncoder().encode(JSON.stringify([evidence])).length);
  expect(JSON.stringify(trace.export())).not.toMatch(/private-source|证据正文/);
});

