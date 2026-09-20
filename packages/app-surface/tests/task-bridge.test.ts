import { expect, it, vi } from "vitest";
import { createBridge, taskQuestion, type SurfaceSpec } from "../src";
const spec: SurfaceSpec = {
  schemaVersion: "blocky.surface-spec/v1",
  title: "报告",
  description: "",
  layout: "stack",
  submitLabel: "提交",
  resultLabel: "结果",
  attachment: true,
  confirmation: true,
  fields: [
    { id: "topic", label: "主题", type: "text", required: true, options: [] },
  ],
};
const request = {
  schemaVersion: "blocky.bridge-request/v1",
  requestId: "request-1",
  endpointId: "ask",
  values: { topic: "植物" },
  attachment: { name: "notes.txt", text: "虚构资料" },
};
it("preserves the legacy single final-reply protocol when runtime emits progress", async () => {
  const send = vi.fn();
  const bridge = createBridge(async (_q, _s, progress) => {
    progress("检索完成");
    return { status: "completed", answer: "旧页面回答", citations: [] };
  }, send);
  await bridge.receive({
    schemaVersion: "blocky.bridge-request/v1alpha1",
    requestId: "legacy-1",
    endpointId: "ask",
    question: "水循环",
  });
  expect(send).toHaveBeenCalledTimes(1);
  expect(send).toHaveBeenCalledWith(
    expect.objectContaining({ ok: true, answer: "旧页面回答" }),
  );
});
it("validates exact declared inputs and attachments without native paths", () => {
  expect(taskQuestion(request, spec).question).toContain("虚构资料");
  for (const input of [
    { ...request, values: { other: "x" } },
    { ...request, attachment: { name: "C:\\secret.txt", text: "x" } },
    { ...request, shell: "x" },
  ])
    expect(() => taskQuestion(input, spec)).toThrow("BLK-SURFACE-002");
  expect(() => taskQuestion(request, { ...spec, attachment: false })).toThrow();
});
it("requires parent approval, emits actual run progress, cancels one request and drops late answer", async () => {
  const send = vi.fn();
  let release!: () => void;
  let signal!: AbortSignal;
  const run = vi.fn(
    async (_q, s: AbortSignal, progress: (s: string) => void) => {
      signal = s;
      progress("检索完成");
      await new Promise<void>((r) => (release = r));
      return { status: "completed", answer: "late", citations: [] };
    },
  );
  const bridge = createBridge(run, send, { spec, confirm: async () => true });
  const pending = bridge.receive(request);
  await Promise.resolve();
  expect(send).toHaveBeenCalledWith({
    kind: "progress",
    requestId: "request-1",
    message: "检索完成",
  });
  await bridge.receive({
    schemaVersion: "blocky.bridge-cancel/v1",
    requestId: "other",
  });
  expect(signal.aborted).toBe(false);
  await bridge.receive({
    schemaVersion: "blocky.bridge-cancel/v1",
    requestId: "request-1",
  });
  expect(signal.aborted).toBe(true);
  release();
  await pending;
  expect(send.mock.calls.at(-1)?.[0]).toMatchObject({ ok: false, answer: "" });
  const denied = createBridge(run, send, { spec, confirm: async () => false });
  await denied.receive({ ...request, requestId: "request-2" });
  expect(run).toHaveBeenCalledTimes(1);
});
