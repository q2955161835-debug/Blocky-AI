import { expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parse } from "../../tools/blocky-cli/src/arguments";

const cli = resolve("tools/blocky-cli/dist/main.mjs");
function run(args: string[], env = process.env) {
  const child = spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", timeout: 30000, windowsHide: true, env });
  return { code: child.status, result: JSON.parse(child.stdout.trim().split(/\r?\n/).at(-1) ?? "{}") };
}
it("discovers persisted receipt queries and refuses invalid checkpoint identities", async () => {
  const dir = await mkdtemp(resolve("try/stage7-rpa-query-"));
  try {
    const env = { ...process.env, LOCALAPPDATA: dir };
    const list = run(["rpa", "checkpoints", "--json"], env);
    expect(list.code).toBe(0);
    expect(list.result.data.checkpoints).toEqual([]);
    expect(list.result.data.modelApiCalled).toBe(false);
    const invalid = run(["rpa", "checkpoint", "checkpoint-../other", "--json"], env);
    expect(invalid.code).not.toBe(0);
    expect(invalid.result.error.code).toBe("BLK-RPA-JOURNAL-002");
    const commands = run(["command", "list", "--query", "rpa checkpoint", "--json"], env);
    expect(commands.result.data.commands.some((c: { usage: string }) => c.usage.includes("--plan"))).toBe(true);
    expect(run(["schema", "show", "blocky.rpa-recovery/v1", "--json"], env).code).toBe(0);
    const preview = run(["rpa", "recovery-preview", "checkpoint-../other", "--json"], env);
    expect(preview.result.error.code).toBe("BLK-RPA-JOURNAL-002");
    const planPath = join(dir, "plan.json"), recoveryPath = join(dir, "recovery.json");
    await writeFile(planPath, JSON.stringify({ schemaVersion: "blocky.rpa/v1", planId: "recover", target: { kind: "windows", identity: "unavailable" }, steps: [{ stepId: "read", action: "read", locator: { kind: "uia", automationId: "field" } }] }));
    await writeFile(recoveryPath, JSON.stringify({ schemaVersion: "blocky.rpa-recovery/v1", checkpointId: "checkpoint-missing", revision: 1, checks: [] }));
    const recovery = run(["rpa", "recover", planPath, "--recovery", recoveryPath, "--jsonl"], env);
    expect(recovery.code).toBe(7);
    expect(recovery.result.error.code).toBe("BLK-RPA-JOURNAL-001");
  } finally { await rm(dir, { recursive: true, force: true }); }
});
it("imports a recording as a pending review draft without typed values", async () => {
  const dir = await mkdtemp(resolve("try/stage7-rpa-"));
  try {
    const input = join(dir, "recording.json"), output = join(dir, "draft.json");
    await writeFile(input, JSON.stringify([{ action: "fill", locator: { kind: "browser", role: "textbox", name: "Password" }, sensitive: true, value: "SECRET_TEXT" }]));
    const created = run(["rpa", "recording-import", input, "--target-kind", "browser", "--target-identity", "https://example.test", "--plan-id", "plan-1", "--output", output, "--json"]);
    expect(created.code).toBe(0);
    const draft = await readFile(output, "utf8");
    expect(draft).not.toContain("SECRET_TEXT");
    expect(JSON.parse(draft).requiresReview).toBe(true);
    const pending = run(["rpa", "validate", output, "--json"]);
    expect(pending.code).toBe(3); // pending draft is not an executable plan
    const plan = join(dir, "reviewed.json");
    await writeFile(plan, JSON.stringify(JSON.parse(draft).plan));
    expect(run(["rpa", "validate", plan, "--json"]).code).toBe(0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
it("discovers real native targets and exposes attended execution commands", () => {
  expect(parse(["rpa", "run", "plan.json", "--control-stdin", "--jsonl"]).options.get("control-stdin")).toBe(true);
  const targets = run(["rpa", "targets", "--json"]);
  expect(targets.code).toBe(0);
  expect(Array.isArray(targets.result.data.targets)).toBe(true);
  expect(targets.result.data.modelApiCalled).toBe(false);
  const commands = run(["command", "list", "--query", "rpa run", "--json"]);
  expect(commands.result.data.commands[0].usage).toContain("--control-stdin");
});
it("rejects unsupported native execution before opening an approval dialog", async () => {
  const dir = await mkdtemp(resolve("try/stage7-rpa-native-"));
  try {
    const plan = join(dir, "plan.json");
    await writeFile(plan, JSON.stringify({ schemaVersion: "blocky.rpa/v1", planId: "unsupported", target: { kind: "browser", identity: "https://example.test" }, steps: [{ stepId: "read", action: "read", locator: { kind: "browser", role: "textbox" }, timeoutMs: 100 }] }));
    const outcome = run(["rpa", "run", plan, "--jsonl"]);
    expect(outcome.code).toBe(7);
    expect(outcome.result.error.code).toBe("BLK-RPA-UNSUPPORTED-001");
    expect(outcome.result.data.completed).toBe(false);
    expect(outcome.result.data.modelApiCalled).toBe(false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
