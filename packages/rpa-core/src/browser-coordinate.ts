import type { Page } from "playwright-core";
import type { RpaStep } from "./index";

export const BROWSER_RPA_VIEWPORT = Object.freeze({ width: 1100, height: 760 });
export type CoordinateViewport = Readonly<{ width: number; height: number }>;

/** Coordinates stay inside a Host-owned page. This never moves the system cursor. */
export async function performBrowserCoordinate(page: Page, step: RpaStep, signal: AbortSignal, approved?: CoordinateViewport) {
  const locator = step.locator, current = page.viewportSize();
  if (locator.kind !== "coordinate" || step.action !== "click" || locator.riskAccepted !== true
    || !approved || !current || current.width !== approved.width || current.height !== approved.height
    || !Number.isInteger(approved.width) || !Number.isInteger(approved.height) || approved.width < 1 || approved.height < 1
    || !Number.isInteger(locator.x) || !Number.isInteger(locator.y) || locator.x < 0 || locator.y < 0
    || locator.x >= approved.width || locator.y >= approved.height)
    throw Error("BLK-RPA-COORDINATE-001");
  signal.throwIfAborted();
  await page.mouse.click(locator.x, locator.y);
  signal.throwIfAborted();
}
