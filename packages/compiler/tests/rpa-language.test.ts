import { expect, it } from "vitest";
import { compileRpaSession, planToRpaBlocks, type RpaPlan } from "@blocky/rpa-core";
import { compileWorkspace } from "../src/module";
import type { IrNode, WorkspaceBlock } from "@blocky/language-schema";

const plan: RpaPlan = {
  schemaVersion: "blocky.rpa/v1", planId: "owned", target: { kind: "browser", identity: "https://example.test" },
  steps: [
    { stepId: "fill", action: "fill", locator: { kind: "browser", role: "textbox", name: "Answer" }, timeoutMs: 1000, effectKey: "fill-once", value: { kind: "manual-input" } },
    { stepId: "read", action: "read", locator: { kind: "browser", role: "textbox", name: "Answer" }, timeoutMs: 1000 },
  ],
};
function compile(root: WorkspaceBlock) {
  return compileWorkspace("owned-project", { moduleId: "main", displayName: "Owned", purpose: "automation", workspaceRef: "workspaces/main.workspace.json", exports: [] }, { blocks: { languageVersion: 0, blocks: [root] } });
}
it("converts a plan into ordinary typed blocks with fresh IDs and ephemeral manual inputs", () => {
  const a = planToRpaBlocks(plan, "https://example.test/form"), b = planToRpaBlocks(plan, "https://example.test/form");
  expect(a.id).not.toBe(b.id);
  const result = compile(a);
  expect(result.diagnostics).toEqual([]);
  const entry = result.ir.roots[0], session = entry.inputs.HANDLER as IrNode;
  const compiled = compileRpaSession(session, "owned-project");
  expect(compiled.plan.steps.map(s => s.action)).toEqual(["fill", "read"]);
  expect(compiled.plan.steps[0].stepId).not.toBe("fill");
  expect(compiled.inputSources[compiled.plan.steps[0].stepId]).toBe("manual");
  expect(compiled.browser).toEqual({ projectId: "owned-project", url: "https://example.test/form" });
  expect(JSON.stringify(a)).not.toContain("fill-once");
});
it("rejects wrong origins, mixed locators, arbitrary nested steps and orphan operations", () => {
  expect(() => planToRpaBlocks(plan, "https://other.test")).toThrow("BLK-RPA-TARGET-001");
  const root = planToRpaBlocks(plan, "https://example.test");
  const attach = root.inputs!.HANDLER.block!, action = attach.inputs!.STEPS.block!;
  action.fields!.LOCATOR = { kind: "uia", automationId: "answer" };
  expect(compile(root).diagnostics.some(d => d.severity === "error")).toBe(true);
  action.fields!.LOCATOR = plan.steps[0].locator;
  action.inputs = { HIDDEN: { block: { type: "core.data.set", id: "hidden", fields: { VALUE: "1" } } } };
  expect(compile(root).diagnostics.some(d => d.severity === "error")).toBe(true);
  delete action.inputs;
  expect(compile(action).diagnostics.some(d => d.code === "BLK-RPA-SCOPE-001")).toBe(true);
});
