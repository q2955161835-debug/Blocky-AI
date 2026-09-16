import { expect, it } from "vitest";
import { runNativeTask } from "../../tools/blocky-cli/src/tasks";
import { createStarter } from "../../packages/test-fixtures/src";
const request = {
  taskId: "blocky.project-check" as const,
  parameters: { passes: 10, "interval-ms": 5 },
  timeoutMs: 5000,
  outputBudgetBytes: 256,
};
it("runs a real bounded native child and reads its exit and truncation", async () => {
  const result = await runNativeTask(
    createStarter(),
    request,
    new AbortController().signal,
  );
  expect(result.status).toBe("exited");
  expect(result.exitCode).toBe(0);
  expect(result.activeProcesses).toBe(0);
  expect(result.truncated).toBe(true);
  expect(result.droppedBytes).toBeGreaterThan(0);
  expect(Buffer.byteLength(result.output)).toBeLessThanOrEqual(256);
  expect(result.output).toContain('"valid":true');
});
it("cancels and times out native work and waits for child settlement", async () => {
  const timeout = await runNativeTask(
    createStarter(),
    {
      ...request,
      parameters: { passes: 100, "interval-ms": 100 },
      timeoutMs: 120,
    },
    new AbortController().signal,
  );
  expect(timeout.status).toBe("timed-out");
  expect(timeout.activeProcesses).toBe(0);
  const abort = new AbortController();
  const pending = runNativeTask(
    createStarter(),
    { ...request, parameters: { passes: 100, "interval-ms": 100 } },
    abort.signal,
  );
  setTimeout(() => abort.abort(), 150);
  const cancelled = await pending;
  expect(cancelled.status).toBe("cancelled");
  expect(cancelled.activeProcesses).toBe(0);
});
