import type { RpaModulePlan } from "./language";
import type { RpaStep } from "./index";
import { rpaCaptureSchema, type RpaCapture } from "./capture";
export type RpaStepResult = { text?: string; capture?: RpaCapture };

export type RpaModuleHandle = {
  checkpointId: string;
  perform(
    step: RpaStep,
    input: string | undefined,
    signal: AbortSignal,
  ): Promise<RpaStepResult>;
  /** Resolves only after native effects and owned processes settle. */
  close(): Promise<void>;
};
export type RpaModulePorts = {
  open(request: RpaModulePlan, signal: AbortSignal): Promise<RpaModuleHandle>;
  manualInput?(
    source: { moduleId: string; blockId: string },
    signal: AbortSignal,
  ): Promise<string>;
};

export function readRpaResult(value: unknown): RpaStepResult {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("BLK-RPA-WORKER-001");
  const text = (value as { text?: unknown }).text;
  const capture = (value as { capture?: unknown }).capture;
  const result: RpaStepResult = {};
  if (capture !== undefined) {
    const parsed = rpaCaptureSchema.safeParse(capture);
    if (!parsed.success) throw Error("BLK-RPA-CAPTURE-002");
    result.capture = parsed.data;
  }
  if (text !== undefined && (typeof text !== "string" || new TextEncoder().encode(text).length > 16384))
    throw Error("BLK-RPA-LIMIT-001");
  if (typeof text === "string") result.text = text;
  return result;
}
