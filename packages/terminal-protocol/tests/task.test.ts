import { expect, it } from "vitest";
import {
  taskDefinition,
  parseTaskRequest,
  rejectTerminalAttachment,
  taskDefinitions,
  parseAgentProcessRequest,
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
it("registers a useful inventory task and keeps agent authorization separate", () => {
  expect(taskDefinitions.map((task) => task.taskId)).toEqual([
    "blocky.project-check",
    "blocky.project-inventory",
  ]);
  const inventory = {
    taskId: "blocky.project-inventory",
    parameters: { limit: 1000 },
    timeoutMs: 1000,
    outputBudgetBytes: 1024,
  };
  expect(parseTaskRequest(inventory).parameters.limit).toBe(1000);
  expect(() =>
    parseTaskRequest({ ...inventory, parameters: { limit: 1001 } }),
  ).toThrow("BLK-TERM-101");
  const agent = {
    requestId: "request-1",
    taskId: inventory.taskId,
    arguments: inventory.parameters,
    capabilityId: "739c7c95-0185-4d56-8cb8-d743dd8c4d00",
    timeoutMs: 1000,
    outputBudgetBytes: 1024,
  };
  expect(parseAgentProcessRequest(agent).requestId).toBe("request-1");
  for (const extra of [
    { caller: { kind: "user" } },
    { terminalSessionId: "private" },
    { cwd: "C:/" },
    { environment: { PATH: "unsafe" } },
  ])
    expect(() => parseAgentProcessRequest({ ...agent, ...extra })).toThrow(
      "BLK-TERM-003",
    );
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
