import { expect, it, vi } from "vitest";
import type { Page } from "playwright-core";
import type { IrNode } from "@blocky/language-schema";
import { BrowserRpaAdapter, compileRpaSession, planToRpaBlocks, rpaNodePermissions, rpaPlanSchema } from "../src";

const plan = (sensitive = true) => ({ schemaVersion: "blocky.rpa/v1", planId: "sensitive-fill", target: { kind: "browser", identity: "https://example.test" }, steps: [
  { stepId: "fill", action: "fill", locator: { kind: "browser", role: "textbox", name: "Password" }, timeoutMs: 1000, effectKey: "fill-once", value: { kind: "manual-input", ...(sensitive ? { sensitive: true } : {}) } },
] });
it("binds sensitive purpose to a manual fill declaration without accepting a credential reference", () => {
  expect(rpaPlanSchema.safeParse(plan()).success).toBe(true);
  const invalid = plan() as any;
  invalid.steps[0].value = { kind: "secret-ref", ref: "provider-key", sensitive: true };
  expect(rpaPlanSchema.safeParse(invalid).success).toBe(false);
});
it("preserves sensitive purpose in a normal proposal and refuses implicit runtime input sources", () => {
  const root = planToRpaBlocks(plan(), "https://example.test/form");
  const container = root.inputs!.HANDLER!.block!;
  const leaf = container.inputs!.STEPS!.block!;
  expect(leaf.fields!.INPUT_KIND).toBe("sensitive");
  const node = { nodeId: "session", blockType: container.type, fields: container.fields, inputs: { STEPS: { nodeId: "fill", blockType: leaf.type, fields: leaf.fields, inputs: {} } } } as unknown as IrNode;
  expect(compileRpaSession(node, "project").plan.steps[0].value).toEqual({ kind: "manual-input", sensitive: true });
  expect(rpaNodePermissions(leaf.type, leaf.fields!)).toContain("rpa.sensitive-input");
  for (const source of ["input", "result"]) {
    (node.inputs.STEPS as IrNode).fields.SOURCE = source;
    expect(() => compileRpaSession(node, "project")).toThrow("BLK-RPA-SENSITIVE-001");
  }
});
it("fills a sensitive control only with declared purpose and never enables reading it", async () => {
  const target = { waitFor: vi.fn(async () => {}), count: vi.fn(async () => 1), evaluate: vi.fn(async () => ({ form: true, sensitive: true })), fill: vi.fn(async () => {}), inputValue: vi.fn(async () => "PRIVATE_CANARY") };
  const page = { isClosed: () => false, url: () => "https://example.test/form", getByRole: () => target } as unknown as Page;
  const resolveInput = vi.fn(async () => "PRIVATE_CANARY"), receiveRead = vi.fn();
  const adapter = new BrowserRpaAdapter(page, "https://example.test", { verifyGrant: async () => true, resolveInput, receiveRead });
  const signal = new AbortController().signal;
  const ordinary = rpaPlanSchema.parse(plan(false)).steps[0];
  await expect(adapter.perform(ordinary, signal)).rejects.toThrow("BLK-RPA-SENSITIVE-001");
  expect(resolveInput).not.toHaveBeenCalled();
  const approved = rpaPlanSchema.parse(plan()).steps[0];
  await adapter.perform(approved, signal);
  expect(target.fill).toHaveBeenCalledWith("PRIVATE_CANARY", { timeout: 1000 });
  await expect(adapter.perform({ ...ordinary, action: "read", value: undefined }, signal)).rejects.toThrow("BLK-RPA-SENSITIVE-001");
  expect(target.inputValue).not.toHaveBeenCalled(); expect(receiveRead).not.toHaveBeenCalled();
});
