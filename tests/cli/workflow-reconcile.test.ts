import { expect, it, vi } from "vitest";
import { parse } from "../../tools/blocky-cli/src/arguments";
import { workflowReconcile } from "../../tools/blocky-cli/src/workflow-reconcile";
const mocked = vi.hoisted(() => ({ native: vi.fn() }));
vi.mock("../../tools/blocky-cli/src/native-store", () => ({
  nativeUserOperation: mocked.native,
}));
it.each(["lost", "malformed"])(
  "directs an unconfirmed applied reconciliation to readback after %s response",
  async (mode) => {
    mocked.native.mockReset();
    if (mode === "lost")
      mocked.native.mockRejectedValue(Error("private-response-canary"));
    else mocked.native.mockResolvedValue({ state: "private-response-canary" });
    const args = parse([
      "workflow",
      "reconcile",
      "task-one",
      "--project-id",
      "project-one",
      "--revision",
      "2",
      "--step",
      "effect",
      "--direction",
      "forward",
      "--outcome",
      "not-executed",
      "--approve",
      "a".repeat(64),
      "--json",
    ]);
    const error = await workflowReconcile(
      args,
      new AbortController().signal,
    ).catch((e) => e);
    expect(error.message).toContain("未确认");
    expect(error.hint).toContain("workflow show");
    expect(error.message + error.hint).not.toContain("private-response-canary");
    expect(mocked.native).toHaveBeenCalledTimes(1);
  },
);
