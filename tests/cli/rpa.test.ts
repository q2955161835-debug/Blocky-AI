import { expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const cli = resolve("tools/blocky-cli/dist/main.mjs");
function run(args: string[]) {
  const child = spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", timeout: 30000, windowsHide: true });
  return { code: child.status, result: JSON.parse(child.stdout.trim().split(/\r?\n/).at(-1) ?? "{}") };
}
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
