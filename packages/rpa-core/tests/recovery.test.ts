import { expect, it } from "vitest";
import { rpaRecoverySchema } from "../src";
const value = { schemaVersion: "blocky.rpa-recovery/v1", checkpointId: "checkpoint-test", revision: 2, checks: [{ stepId: "saved-step", locator: { kind: "uia", automationId: "confirmed-state" }, expectedText: "done" }] };
it("validates bounded explicit recovery predicates and rejects extra authority", () => {
  expect(rpaRecoverySchema.safeParse(value).success).toBe(true);
  for (const changed of [
    { ...value, checkpointId: "checkpoint-../elsewhere" }, { ...value, revision: 0 }, { ...value, sessionId: "forged" },
    { ...value, checks: [...value.checks, ...value.checks] },
    { ...value, checks: [{ ...value.checks[0], locator: { kind: "uia" } }] },
    { ...value, checks: [{ ...value.checks[0], locator: { kind: "coordinate", x: 1, y: 2, riskAccepted: true } }] },
    { ...value, checks: [{ ...value.checks[0], expectedText: "密".repeat(400) }] },
    { ...value, checks: [{ ...value.checks[0], expectedText: "a\0b" }] },
  ]) expect(rpaRecoverySchema.safeParse(changed).success).toBe(false);
});
