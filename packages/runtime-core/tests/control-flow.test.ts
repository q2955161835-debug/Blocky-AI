import { expect, it } from "vitest";
import type { IrNode, Json } from "@blocky/language-schema";
import { RunBudget } from "../src/budget";
import {
  executeControlFlow,
  assertRetrySafe,
  type ControlState,
} from "../src/control-flow";
const child: IrNode = {
  nodeId: "body",
  blockType: "core.data.set",
  fields: { VALUE: "1" },
  inputs: {},
};
const node = (
  type: string,
  fields: Record<string, Json> = {},
  port = "DO",
): IrNode => ({
  nodeId: "loop",
  blockType: type,
  fields,
  inputs: { [port]: child },
});
function state(value: Json = null): ControlState {
  return { value, question: "input", memory: null, budget: new RunBudget() };
}
it("foreach executes each original item once and returns ordered per-item results", async () => {
  const context = state([2, 4, 6]),
    seen: Json[] = [];
  try {
    await executeControlFlow(
      node("core.flow.foreach", { SOURCE: "result", MAX_ITEMS: "4" }),
      context,
      async () => {
        seen.push(context.value);
        context.value = Number(context.value) * 2;
      },
    );
    expect(seen).toEqual([2, 4, 6]);
    expect(context.value).toEqual([4, 8, 12]);
    context.value = [1, 2, 3];
    await expect(
      executeControlFlow(
        node("core.flow.foreach", { SOURCE: "result", MAX_ITEMS: "2" }),
        context,
        async () => {
          throw Error("must not execute");
        },
      ),
    ).rejects.toThrow("BLK-FLOW-LIMIT");
  } finally {
    context.budget.dispose();
  }
});
it("while reevaluates the changed result and stops before an extra iteration", async () => {
  const context = state(true);
  let count = 0;
  try {
    await executeControlFlow(
      node("core.flow.while", {
        SOURCE: "result",
        OP: "truthy",
        MAX_ITERATIONS: "3",
      }),
      context,
      async () => {
        context.value = ++count < 3;
      },
    );
    expect(count).toBe(3);
    expect(context.value).toBe(false);
    context.value = true;
    await expect(
      executeControlFlow(
        node("core.flow.while", {
          SOURCE: "result",
          OP: "truthy",
          MAX_ITERATIONS: "2",
        }),
        context,
        async () => {
          count++;
        },
      ),
    ).rejects.toThrow("BLK-FLOW-LIMIT");
    expect(count).toBe(5);
  } finally {
    context.budget.dispose();
  }
});
it("bounded retry restores the prior result and never repeats unsafe effects", async () => {
  const context = state("original");
  let attempts = 0;
  try {
    await executeControlFlow(
      node("core.flow.retry", { ATTEMPTS: "3", WAIT_MS: "0" }),
      context,
      async () => {
        expect(context.value).toBe("original");
        context.value = "changed";
        if (++attempts === 1) throw Error("BLK-FLOW-003");
      },
    );
    expect(attempts).toBe(2);
    expect(context.value).toBe("changed");
    for (const type of [
      "core.memory.write",
      "core.reason.tool_loop",
      "core.event.send",
      "core.module.call",
      "tool.desktop.click",
    ]) {
      expect(() => assertRetrySafe({ ...child, blockType: type })).toThrow(
        "BLK-FLOW-RETRY-UNSAFE",
      );
    }
  } finally {
    context.budget.dispose();
  }
});
it("try exposes a stable error code without remote detail and cannot swallow cancellation or unknown effects", async () => {
  const context = state();
  const attempt = node("core.flow.try", {}, "TRY");
  attempt.inputs.CATCH = { ...child, nodeId: "catch" };
  try {
    await executeControlFlow(attempt, context, async (n) => {
      if (n.nodeId === "body") throw Error("BLK-FLOW-003");
      expect(context.value).toEqual({ error: { code: "BLK-FLOW-003" } });
      context.value = "recovered";
    });
    expect(context.value).toBe("recovered");
    for (const code of [
      "BLK-RUN-005",
      "BLK-TOOL-UNCERTAIN",
      "BLK-APPROVAL-001",
    ]) {
      await expect(
        executeControlFlow(attempt, context, async () => {
          throw Error(code);
        }),
      ).rejects.toThrow(code);
    }
  } finally {
    context.budget.dispose();
  }
});
it("repeat obeys zero count and cancellation between iterations", async () => {
  const context = state();
  let calls = 0;
  try {
    await executeControlFlow(
      node("core.flow.repeat", { COUNT: "0" }),
      context,
      async () => {
        calls++;
      },
    );
    expect(calls).toBe(0);
    await expect(
      executeControlFlow(
        node("core.flow.repeat", { COUNT: "10" }),
        context,
        async () => {
          calls++;
          context.budget.controller.abort(Error("BLK-RUN-005"));
        },
      ),
    ).rejects.toThrow("BLK-RUN-005");
    expect(calls).toBe(1);
  } finally {
    context.budget.dispose();
  }
});
