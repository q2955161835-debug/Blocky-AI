import { expect, it } from "vitest";
import {
  taskDefinition,
  parseTaskRequest,
  rejectTerminalAttachment,
} from "../src";
it("validates the registered task's parameter and resource budgets without accepting shell fields", () => {
  expect(taskDefinition.command.executableRef).toBe("blocky.project-check");
  const valid = {
    taskId: "blocky.project-check",
    parameters: { passes: 3, "interval-ms": 10 },
    timeoutMs: 1000,
    outputBudgetBytes: 1024,
  };
  expect(parseTaskRequest(valid).parameters.passes).toBe(3);
  for (const change of [
    { parameters: { passes: 0, "interval-ms": 10 } },
    { parameters: { passes: 3.5, "interval-ms": 10 } },
    { parameters: { passes: 1, "interval-ms": 0, command: "calc" } },
    { cwd: "C:/" },
    { environment: {} },
    { outputBudgetBytes: 100000000 },
    { timeoutMs: 0 },
    { taskId: "shell" },
  ]) {
    expect(() => parseTaskRequest({ ...valid, ...change })).toThrow(
      "BLK-TERM-101",
    );
  }
});
it("rejects all attempts to attach to user terminal handles before execution", () => {
  for (const kind of ["builder", "agent", "skill", "extension", "rpa"]) {
    expect(() =>
      rejectTerminalAttachment({
        caller: { kind, id: "caller" },
        terminalSessionId: "terminal-user",
      }),
    ).toThrow("BLK-TERM-003");
  }
});
