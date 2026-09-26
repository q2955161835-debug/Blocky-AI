import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  parseWorkflow,
  transitionWorkflow,
  workflowSummary,
  type WorkflowTransition,
} from "../src/workflow";

const cases = JSON.parse(
  readFileSync(
    new URL(
      "../../../apps/studio-host/tests/fixtures/workflow-parity.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as {
  name: string;
  initial: unknown;
  steps: { action: WorkflowTransition; after: unknown; summary: unknown }[];
}[];
describe("workflow native protocol parity", () => {
  for (const scenario of cases)
    it(scenario.name, () => {
      let record = parseWorkflow(scenario.initial);
      for (const step of scenario.steps) {
        record = transitionWorkflow(record, step.action);
        expect(record).toEqual(step.after);
        expect(workflowSummary(record)).toEqual(step.summary);
      }
    });
});
