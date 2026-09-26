import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { workflowSummary, parseWorkflow } from "../../packages/runtime-core/src/workflow";
import { workflowSummarySchema } from "../../tools/blocky-cli/src/workflow-schema";

it("accepts all shared workflow summaries while rejecting private state at any projection level", () => {
  const cases = JSON.parse(readFileSync("apps/studio-host/tests/fixtures/workflow-parity.json", "utf8"));
  for (const scenario of cases) {
    for (const item of scenario.steps) {
      const summary = workflowSummary(parseWorkflow(item.after));
      expect(workflowSummarySchema.parse(item.summary)).toEqual(summary);
      expect(workflowSummarySchema.safeParse({ ...summary, state: "private" }).success).toBe(false);
      const receipt = structuredClone(summary);
      Object.assign(receipt.receipts[0], { before: "private" });
      expect(workflowSummarySchema.safeParse(receipt).success).toBe(false);
    }
  }
});
