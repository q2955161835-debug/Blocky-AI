import { expect, it, vi } from "vitest";
import type { CodingStart } from "@blocky/builder-protocol";
import { createStarter } from "../../test-fixtures/src";
import { runCodingAgent } from "../src/coding";
import { CodingGenerationError } from "../src/generation-error";
import type { BuilderGeneration } from "../src/transport";

const start: CodingStart = {
  schemaVersion: "blocky.coding-start/v1", requestId: "recovery-test",
  projectId: "research-workbench", moduleId: "research-agent",
  prompt: "完成编辑", originalJson: JSON.stringify(createStarter()),
  resourceId: "model", selection: [], conversation: [],
};
const metadata = (id: string) => ({
  provider: "fixture", model: "fixture", requestId: id, transport: "local",
  usageStatus: "reported" as const,
  usage: { inputTokens: 20, outputTokens: 4096, totalTokens: 4116 },
});
const result = (id: string, content: BuilderGeneration["content"]): BuilderGeneration => ({ ...metadata(id), content });

it("regenerates a rejected tool response without replaying completed tools and retains failed usage", async () => {
  const executeTool = vi.fn(async () => ({ ok: true }));
  const generated = vi.fn(async ({ turn, messages }) => {
    if (turn === 1) return result("first", [{ type: "toolCall", id: "edit-once", name: "blocky_cli", arguments: { args: ["project", "compile", "$project", "--json"] } }]);
    if (turn === 2) throw new CodingGenerationError("BLK-MODEL-RESPONSE-TOOL-JSON", metadata("rejected"));
    expect(turn).toBe(3);
    expect(messages.at(-1)?.content).toContain("未执行");
    expect(messages.filter((m: { role: string }) => m.role === "tool")).toHaveLength(1);
    return result("recovered", [{ type: "text", text: "已核对" }]);
  });
  const output = await runCodingAgent(start, { modelId: "fixture", executeTool, generate: generated });
  expect(executeTool).toHaveBeenCalledTimes(1);
  expect(generated).toHaveBeenCalledTimes(3);
  expect(output.generations.map(g => g.requestId)).toEqual(["first", "rejected", "recovered"]);
  expect(output.generations[1].usage?.outputTokens).toBe(4096);
  expect(output.events.some(event => event.kind === "text.delta" && event.text?.includes("重新生成（1/2）"))).toBe(true);
  expect(output.text).toContain("已核对");
});

it("stops after two corrections without executing malformed calls", async () => {
  const generate = vi.fn(async () => { throw new CodingGenerationError("BLK-MODEL-RESPONSE-TOOL-JSON", metadata("rejected")); });
  const executeTool = vi.fn();
  await expect(runCodingAgent(start, { modelId: "fixture", executeTool, generate })).rejects.toThrow("BLK-MODEL-RESPONSE-TOOL-JSON");
  expect(generate).toHaveBeenCalledTimes(3);
  expect(executeTool).not.toHaveBeenCalled();
});

it.each(["BLK-MODEL-RESPONSE-USAGE-SUM", "BLK-PROVIDER-TIMEOUT", "BLK-MODEL-TRUNCATED-LENGTH", "BLK-MODEL-RESPONSE-TOOLS"])("does not retry %s", async code => {
  const generate = vi.fn(async () => { throw new CodingGenerationError(code, metadata("failed")); });
  await expect(runCodingAgent(start, { modelId: "fixture", executeTool: vi.fn(), generate })).rejects.toThrow(code);
  expect(generate).toHaveBeenCalledTimes(1);
});

it("honors stop during correction before another request", async () => {
  const controller = new AbortController(), executeTool = vi.fn();
  const generate = vi.fn(async () => { throw new CodingGenerationError("BLK-MODEL-RESPONSE-TOOL-JSON", metadata("failed")); });
  await expect(runCodingAgent(start, { modelId: "fixture", signal: controller.signal, executeTool, generate,
    onEvent(event) { if (event.kind === "text.delta" && event.text?.includes("重新生成")) controller.abort(); },
  })).rejects.toThrow("BLK-CODING-CANCELLED");
  expect(generate).toHaveBeenCalledTimes(1);
  expect(executeTool).not.toHaveBeenCalled();
});
