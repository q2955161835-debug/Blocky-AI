import { z } from "zod";
import definition from "./project-check.json";
import inventory from "./project-inventory.json";
export const taskDefinition = definition;
export const taskDefinitions = [definition, inventory] as const;
export function getTaskDefinition(taskId: string) {
  const found = taskDefinitions.find((task) => task.taskId === taskId);
  if (!found) throw Error("BLK-TERM-101");
  return found;
}
const request = z
  .object({
    taskId: z.enum(["blocky.project-check", "blocky.project-inventory"]),
    parameters: z.record(z.string(), z.number().finite()),
    timeoutMs: z.number().int().min(1).max(definition.timeoutMs),
    outputBudgetBytes: z
      .number()
      .int()
      .min(256)
      .max(definition.outputBudgetBytes),
  })
  .strict();
export type TaskRequest = z.infer<typeof request>;
export function parseTaskRequest(input: unknown): TaskRequest {
  try {
    const value = request.parse(input);
    const definition = getTaskDefinition(value.taskId);
    if (
      value.timeoutMs > definition.timeoutMs ||
      value.outputBudgetBytes > definition.outputBudgetBytes
    )
      throw Error();
    if (Object.keys(value.parameters).length !== definition.parameters.length)
      throw Error();
    for (const parameter of definition.parameters) {
      const current = value.parameters[parameter.parameterId];
      if (typeof current !== "number") throw Error();
      for (const rule of parameter.validationRules) {
        if (rule.kind === "integer" && !Number.isInteger(current))
          throw Error();
        if (rule.kind === "minimum" && current < Number(rule.argument))
          throw Error();
        if (rule.kind === "maximum" && current > Number(rule.argument))
          throw Error();
      }
    }
    return value;
  } catch {
    throw Error("BLK-TERM-101");
  }
}
const agentRequest = z
  .object({
    requestId: z.string().min(1).max(128),
    taskId: z.string(),
    arguments: z.record(z.string(), z.number().finite()),
    capabilityId: z.string().uuid(),
    timeoutMs: z.number().int(),
    outputBudgetBytes: z.number().int(),
  })
  .strict();
export type AgentProcessRequest = z.infer<typeof agentRequest>;
// Shape validation never grants authority. Only the Host validates the opaque ticket
// against its authenticated principal and consumes it before execution.
export function parseAgentProcessRequest(input: unknown): AgentProcessRequest {
  try {
    const value = agentRequest.parse(input);
    parseTaskRequest({
      taskId: value.taskId,
      parameters: value.arguments,
      timeoutMs: value.timeoutMs,
      outputBudgetBytes: value.outputBudgetBytes,
    });
    return value;
  } catch {
    throw Error("BLK-TERM-003");
  }
}
export function rejectTerminalAttachment(_input: unknown): never {
  throw Error("BLK-TERM-003");
}
export type TaskSnapshot = {
  schemaVersion: "blocky.task-result/v1alpha1";
  requestId: string;
  taskId: string;
  status:
    | "starting"
    | "running"
    | "exited"
    | "failed"
    | "cancelled"
    | "timed-out";
  exitCode: number | null;
  output: string;
  outputBytes: number;
  droppedBytes: number;
  truncated: boolean;
  activeProcesses: number;
};
