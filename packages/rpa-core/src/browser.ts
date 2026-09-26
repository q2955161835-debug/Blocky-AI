import type { Page } from "playwright-core";
import { CAPTURE_MASK_SELECTOR, concealCaptureInputs } from "./browser-capture-mask";
import { performBrowserCoordinate, type CoordinateViewport } from "./browser-coordinate";
import type { RpaAdapter, RpaGrant, RpaPlan, RpaReceipt, RpaStep } from "./index";

export type BrowserRpaPorts = {
  coordinateViewport?: CoordinateViewport;
  verifyGrant(grant: RpaGrant, plan: RpaPlan, signal: AbortSignal): Promise<boolean>;
  resolveInput?(step: RpaStep, signal: AbortSignal): Promise<string>;
  receiveRead?(stepId: string, text: string): void;
  receiveScreenshot?(stepId: string, image: Uint8Array, maskedRegions: number): void;
  verifyEffect?(receipt: RpaReceipt, step: RpaStep, signal: AbortSignal): Promise<boolean>;
};

/** Page is injected by the Host after the user chooses a tab; this adapter never attaches to a browser itself. */
export class BrowserRpaAdapter implements RpaAdapter {
  readonly targetIdentity: string;
  constructor(private readonly page: Page, private readonly origin: string, private readonly ports: BrowserRpaPorts, identity?: string) {
    const parsed = new URL(origin);
    if (!(["https:", "http:"].includes(parsed.protocol)) || parsed.origin !== origin)
      throw Error("BLK-RPA-TARGET-001");
    this.targetIdentity = identity ?? origin;
  }
  async verifyTarget(signal: AbortSignal): Promise<boolean> {
    signal.throwIfAborted();
    if (this.page.isClosed()) return false;
    try { return new URL(this.page.url()).origin === this.origin; }
    catch { return false; }
  }
  verifyGrant(grant: RpaGrant, plan: RpaPlan, signal: AbortSignal): Promise<boolean> {
    return this.ports.verifyGrant(grant, plan, signal);
  }
  async verifyReceipt(receipt: RpaReceipt, step: RpaStep, signal: AbortSignal): Promise<boolean> {
    if (!await this.verifyTarget(signal)) return false;
    return this.ports.verifyEffect ? this.ports.verifyEffect(receipt, step, signal) : false;
  }
  async perform(step: RpaStep, signal: AbortSignal): Promise<void> {
    if (!await this.verifyTarget(signal)) throw Error("BLK-RPA-TARGET-001");
    if (step.locator.kind === "uia") throw Error("BLK-RPA-LOCATOR-002");
    if (step.locator.kind === "coordinate") {
      return performBrowserCoordinate(this.page, step, signal, this.ports.coordinateViewport);
    }
    const role = step.locator.role as Parameters<Page["getByRole"]>[0];
    const target = this.page.getByRole(role, { ...(step.locator.name !== undefined ? { name: step.locator.name, exact: true } : {}) });
    await target.waitFor({ state: "visible", timeout: step.timeoutMs });
    signal.throwIfAborted();
    if (await target.count() !== 1) throw Error("BLK-RPA-LOCATOR-004");
    // A page can navigate while a locator is waiting. Rebind immediately before the action.
    if (!await this.verifyTarget(signal)) throw Error("BLK-RPA-TARGET-001");
    switch (step.action) {
      case "find": case "wait": break;
      case "read": {
        if (!this.ports.receiveRead) throw Error("BLK-RPA-PORT-001");
        const form = await inspectInput(target);
        const text = form ? await target.inputValue({ timeout: step.timeoutMs }) : await target.innerText({ timeout: step.timeoutMs });
        if (new TextEncoder().encode(text).byteLength > 16384) throw Error("BLK-RPA-LIMIT-001");
        this.ports.receiveRead(step.stepId, text);
        break;
      }
      case "click": await target.click({ timeout: step.timeoutMs }); break;
      case "fill": {
        if (!this.ports.resolveInput || !step.value) throw Error("BLK-RPA-PORT-001");
        const sensitive = step.value.kind === "manual-input" && step.value.sensitive === true;
        await inspectInput(target, sensitive);
        const value = await this.ports.resolveInput(step, signal);
        signal.throwIfAborted();
        if (!await this.verifyTarget(signal)) throw Error("BLK-RPA-TARGET-001");
        await inspectInput(target, sensitive);
        if (new TextEncoder().encode(value).byteLength > 16384 || value.includes("\0")) throw Error("BLK-RPA-INPUT-001");
        await target.fill(value, { timeout: step.timeoutMs });
        break;
      }
      case "screenshot": {
        if (!this.ports.receiveScreenshot) throw Error("BLK-RPA-PORT-001");
        const box = await target.boundingBox({ timeout: step.timeoutMs });
        if (!box || box.width < 1 || box.height < 1 || box.width > 2048 || box.height > 2048) throw Error("BLK-RPA-CAPTURE-003");
        // Mask all form/editable fields, including ordinary inputs, and whole
        // embedded documents whose private contents are not inspected here.
        const mask = this.page.locator(CAPTURE_MASK_SELECTOR);
        const maskedRegions = await mask.count();
        if (maskedRegions > 2048) throw Error("BLK-RPA-CAPTURE-003");
        const hidden = await concealCaptureInputs(this.page, mask);
        let bytes: Uint8Array;
        try {
          if (!await hidden.valid()) throw Error("BLK-RPA-CAPTURE-005");
          bytes = await target.screenshot({ timeout: step.timeoutMs, mask: [mask], maskColor: "#000000", animations: "disabled", caret: "hide", scale: "css" });
          if (!await hidden.valid()) { bytes.fill(0); throw Error("BLK-RPA-CAPTURE-005"); }
        } finally { await hidden.restore(); }
        if (bytes.byteLength > 4 * 1024 * 1024 || !await this.verifyTarget(signal)) throw Error("BLK-RPA-CAPTURE-003");
        this.ports.receiveScreenshot(step.stepId, bytes, maskedRegions);
        break;
      }
    }
    signal.throwIfAborted();
  }
}
async function inspectInput(target: ReturnType<Page["getByRole"]>, allowSensitiveFill = false) {
  const metadata = await target.evaluate((element) => {
    const type = element.getAttribute("type")?.toLowerCase();
    const hints = ["autocomplete", "name", "id", "aria-label", "placeholder"].map((name) => element.getAttribute(name) ?? "").join(" ");
    const form = ["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName);
    return { form, sensitive: type === "password" || (form || (element as HTMLElement).isContentEditable) && /password|secret|api[-_ ]?key|token|one-time-code|cc-number|密码|密钥|验证码/i.test(hints) };
  });
  if (metadata.sensitive && !allowSensitiveFill) throw Error("BLK-RPA-SENSITIVE-001");
  return metadata.form;
}
