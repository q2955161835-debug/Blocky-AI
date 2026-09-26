import { expect, it, vi } from "vitest";
import type { Page } from "playwright-core";
import { BrowserRpaAdapter, rpaPlanSchema } from "../src";

const step = { stepId: "click", action: "click" as const, locator: { kind: "coordinate" as const, x: 10, y: 20, riskAccepted: true as const }, effectKey: "once", timeoutMs: 5000 };
it("accepts negative physical coordinates only for Windows monitors", () => {
  const plan = { schemaVersion: "blocky.rpa/v1", planId: "negative", target: { kind: "windows", identity: "owned-window" }, steps: [{ ...step, locator: { ...step.locator, x: -100, y: -20 } }] };
  expect(rpaPlanSchema.safeParse(plan).success).toBe(true);
  expect(rpaPlanSchema.safeParse({ ...plan, target: { kind: "browser", identity: "https://owned.test" } }).success).toBe(false);
  expect(rpaPlanSchema.safeParse({ ...plan, steps: [{ ...step, locator: { ...step.locator, x: -32769 } }] }).success).toBe(false);
});
it("permits coordinate clicks only and requires explicit risk acceptance", () => {
  const plan = { schemaVersion: "blocky.rpa/v1", planId: "coordinate", target: { kind: "browser", identity: "https://owned.test" }, steps: [step] };
  expect(rpaPlanSchema.safeParse(plan).success).toBe(true);
  for (const action of ["find", "read", "wait", "screenshot", "fill"])
    expect(rpaPlanSchema.safeParse({ ...plan, steps: [{ ...step, action, ...(action === "fill" ? { value: { kind: "manual-input" } } : {}) }] }).success, action).toBe(false);
  expect(rpaPlanSchema.safeParse({ ...plan, steps: [{ ...step, locator: { ...step.locator, riskAccepted: false } }] }).success).toBe(false);
});

it("refuses missing coordinate authority, out-of-bounds pixels and changed viewport before dispatch", async () => {
  let viewport = { width: 100, height: 80 };
  const click = vi.fn(async () => {});
  const page = { isClosed: () => false, url: () => "https://owned.test/", viewportSize: () => viewport, mouse: { click } } as unknown as Page;
  const signal = new AbortController().signal;
  await expect(new BrowserRpaAdapter(page, "https://owned.test", { verifyGrant: async () => true }).perform(step, signal)).rejects.toThrow("BLK-RPA-COORDINATE-001");
  const adapter = new BrowserRpaAdapter(page, "https://owned.test", { verifyGrant: async () => true, coordinateViewport: { ...viewport } });
  for (const [x, y] of [[100, 20], [10, 80], [-1, 20], [10.5, 20], [NaN, 20]])
    await expect(adapter.perform({ ...step, locator: { ...step.locator, x, y } }, signal)).rejects.toThrow("BLK-RPA-COORDINATE-001");
  viewport = { width: 101, height: 80 };
  await expect(adapter.perform(step, signal)).rejects.toThrow("BLK-RPA-COORDINATE-001");
  expect(click).not.toHaveBeenCalled();
  viewport = { width: 100, height: 80 };
  await adapter.perform(step, signal);
  expect(click).toHaveBeenCalledExactlyOnceWith(10, 20);
  const cancelled = AbortSignal.abort();
  await expect(adapter.perform(step, cancelled)).rejects.toThrow();
  expect(click).toHaveBeenCalledTimes(1);
});
