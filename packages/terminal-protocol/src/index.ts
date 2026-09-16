import { z } from "zod";
import definition from "./project-check.json";
export const taskDefinition = definition;
const request = z.object({
  taskId: z.literal("blocky.project-check"),
  parameters: z.record(z.string(), z.number().finite()),
  timeoutMs: z.number().int().min(1).max(definition.timeoutMs),
  outputBudgetBytes: z.number().int().min(256).max(definition.outputBudgetBytes),
}).strict();
export type TaskRequest = z.infer<typeof request>;
export function parseTaskRequest(input: unknown): TaskRequest {
  try {
    const value = request.parse(input);
    if (Object.keys(value.parameters).length !== definition.parameters.length) throw Error();
    for (const parameter of definition.parameters) {
      const current = value.parameters[parameter.parameterId];
      if (typeof current !== "number") throw Error();
      for (const rule of parameter.validationRules) {
        if (rule.kind === "integer" && !Number.isInteger(current)) throw Error();
        if (rule.kind === "minimum" && current < Number(rule.argument)) throw Error();
        if (rule.kind === "maximum" && current > Number(rule.argument)) throw Error();
      }
    }
    return value;
  } catch { throw Error("BLK-TERM-101"); }
}
export function rejectTerminalAttachment(_input: unknown): never { throw Error("BLK-TERM-003"); }
export type TaskSnapshot = {
  schemaVersion: "blocky.task-result/v1alpha1";
  requestId: string;
  taskId: string;
  status: "starting" | "running" | "exited" | "failed" | "cancelled" | "timed-out";
  exitCode: number | null;
  output: string;
  outputBytes: number;
  droppedBytes: number;
  truncated: boolean;
  activeProcesses: number;
};
