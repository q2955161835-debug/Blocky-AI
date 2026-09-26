import { expect, it, vi } from "vitest";
import type { Page } from "playwright-core";
import { AttendedRpaRun, BrowserRpaAdapter } from "../src";
vi.mock("../src/browser-capture-mask", () => ({ CAPTURE_MASK_SELECTOR: "input,textarea,iframe", concealCaptureInputs: async () => ({ valid: async () => true, restore: async () => {} }) }));

it("masks form fields and embedded pages before capturing the approved element", async () => {
  const mask = { count: vi.fn(async () => 2) };
  const target = { waitFor: vi.fn(async () => {}), count: vi.fn(async () => 1), boundingBox: vi.fn(async () => ({ x: 0, y: 0, width: 200, height: 100 })), screenshot: vi.fn(async () => new Uint8Array([1, 2])) };
  const page = { isClosed: () => false, url: () => "https://example.test/form", getByRole: () => target, locator: vi.fn(() => mask) } as unknown as Page;
  const receiveScreenshot = vi.fn();
  const adapter = new BrowserRpaAdapter(page, "https://example.test", { verifyGrant: async () => true, receiveScreenshot });
  await adapter.perform({ stepId: "shot", action: "screenshot", locator: { kind: "browser", role: "main" }, timeoutMs: 1000 }, new AbortController().signal);
  expect(target.screenshot).toHaveBeenCalledWith(expect.objectContaining({ mask: [mask], maskColor: "#000000", animations: "disabled", caret: "hide", scale: "css" }));
  expect(receiveScreenshot).toHaveBeenCalledWith("shot", new Uint8Array([1, 2]), 2);
});

it("binds browser operations to one Host-selected origin and semantic locator", async () => {
  const target = {
    waitFor: vi.fn(async () => {}), count: vi.fn(async () => 1), click: vi.fn(async () => {}),
    fill: vi.fn(async () => {}), innerText: vi.fn(async () => "private content"), screenshot: vi.fn(async () => new Uint8Array([1, 2])),
    evaluate: vi.fn(async () => ({ form: false, sensitive: false })),
  };
  let url = "https://example.test/flow";
  const page = { isClosed: () => false, url: () => url, getByRole: vi.fn(() => target), mouse: { click: vi.fn(async () => {}) } } as unknown as Page;
  const seen: string[] = [];
  const adapter = new BrowserRpaAdapter(page, "https://example.test", { verifyGrant: async () => true, receiveRead: (_id, value) => seen.push(value), verifyEffect: async () => true });
  const plan = { schemaVersion: "blocky.rpa/v1", planId: "browser-flow", target: { kind: "browser", identity: "https://example.test" }, steps: [
    { stepId: "read-1", action: "read", locator: { kind: "browser", role: "heading", name: "Result" }, timeoutMs: 5000 },
    { stepId: "click-1", action: "click", locator: { kind: "browser", role: "button", name: "Submit" }, timeoutMs: 5000, effectKey: "submit-1" },
  ] };
  const grant = { schemaVersion: "blocky.rpa-grant/v1", sessionId: "browser-session", targetIdentity: "https://example.test", actions: ["read", "click"], expiresAt: 2000 };
  const events: unknown[] = [];
  const receipts = await new AttendedRpaRun().run(plan, grant, adapter, { now: () => 1000, onEvent: (event) => events.push(event) });
  expect(receipts).toHaveLength(1);
  expect(page.getByRole).toHaveBeenCalledWith("heading", { name: "Result", exact: true });
  expect(seen).toEqual(["private content"]);
  expect(JSON.stringify(events)).not.toContain("private content");
  url = "https://evil.test/flow";
  await expect(new AttendedRpaRun().run(plan, grant, adapter, { now: () => 1000 })).rejects.toThrow("BLK-RPA-TARGET-001");
  expect(target.click).toHaveBeenCalledOnce();
});

it("does not act when the tab navigates away while waiting for a locator", async () => {
  let url = "https://example.test/flow";
  const target = {
    waitFor: vi.fn(async () => { url = "https://evil.test/flow"; }),
    count: vi.fn(async () => 1), click: vi.fn(async () => {}),
  };
  const page = { isClosed: () => false, url: () => url, getByRole: vi.fn(() => target) } as unknown as Page;
  const adapter = new BrowserRpaAdapter(page, "https://example.test", { verifyGrant: async () => true });
  const plan = { schemaVersion: "blocky.rpa/v1", planId: "navigation-flow", target: { kind: "browser", identity: "https://example.test" },
    steps: [{ stepId: "click-1", action: "click", locator: { kind: "browser", role: "button", name: "Submit" }, timeoutMs: 5000, effectKey: "submit-1" }] };
  const grant = { schemaVersion: "blocky.rpa-grant/v1", sessionId: "browser-session", targetIdentity: "https://example.test", actions: ["click"], expiresAt: 2000 };
  await expect(new AttendedRpaRun().run(plan, grant, adapter, { now: () => 1000 })).rejects.toThrow("BLK-RPA-TARGET-001");
  expect(target.click).not.toHaveBeenCalled();
});
