import type { RpaModulePlan } from "./language";
import type { RpaStep } from "./index";

export type RpaModuleHandle = {
  checkpointId: string;
  perform(
    step: RpaStep,
    input: string | undefined,
    signal: AbortSignal,
  ): Promise<{ text?: string }>;
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

export function readRpaResult(value: unknown): { text?: string } {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("BLK-RPA-WORKER-001");
  const text = (value as { text?: unknown }).text;
  if (text === undefined) return {};
  if (typeof text !== "string" || new TextEncoder().encode(text).length > 16384)
    throw Error("BLK-RPA-LIMIT-001");
  return { text };
}
