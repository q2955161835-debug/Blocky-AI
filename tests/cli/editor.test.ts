import { expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createStarter } from "../../packages/test-fixtures/src";
import { createModule, projectDigest } from "../../packages/project-model/src";
import { createProject, readProject } from "../../tools/blocky-cli/src/native-store";

const cli = resolve("tools/blocky-cli/dist/main.mjs");
function run(args: string[]) {
  const child = spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", timeout: 30000, windowsHide: true });
  return { code: child.status, lines: child.stdout.trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line)) };
}

it("uses the shared edit transaction and produces a read-only trace without model calls", async () => {
  const directory = await mkdtemp(resolve("try/stage7-editor-"));
  try {
    const original = createStarter();
    createModule(original, "target-canvas", "目标画布");
    const source = join(directory, "source.blocky");
    const edited = join(directory, "edited.blocky");
    const operations = join(directory, "operations.json");
    await createProject(source, original);
    await writeFile(operations, JSON.stringify([
      { kind: "edit", moduleId: "research-agent", ids: ["research-root"], edit: { kind: "group", groupId: "group-work", label: "任务区域" } },
      { kind: "copy", sourceModuleId: "research-agent", targetModuleId: "target-canvas", ids: ["research-root"] },
    ]));
    const digest = await projectDigest(original);
    const map = run(["project", "map", source, "--json"]);
    expect(map.code).toBe(0);
    expect(map.lines[0].data.modules).toHaveLength(3);
    const conflict = run(["project", "edit", source, "--operations", operations, "--expect-digest", "0".repeat(64), "--output", edited, "--json"]);
    expect(conflict.code).toBe(5);
    const result = run(["project", "edit", source, "--operations", operations, "--expect-digest", digest, "--output", edited, "--json"]);
    expect(result.code).toBe(0);
    expect((await readProject(edited)).workspaces["target-canvas"].blocks.blocks).toHaveLength(1);
    expect((await readProject(source)).workspaces["target-canvas"].blocks.blocks).toHaveLength(0);
    const actions = join(directory, "actions.json");
    const trace = join(directory, "trace.json");
    await writeFile(actions, JSON.stringify(["step", "continue"]));
    const execution = run(["run", "start", source, "--simulate", "--input", "水循环", "--breakpoint", "research-agent:on-question", "--debug-actions", actions, "--trace-output", trace, "--jsonl"]);
    expect(execution.code).toBe(0);
    expect(execution.lines.filter((event) => event.type === "run.paused")).toHaveLength(2);
    const exported = JSON.parse(await readFile(trace, "utf8"));
    expect(exported.schemaVersion).toBe("blocky.trace/v1");
    expect(JSON.stringify(exported)).not.toContain("水循环");
    const inspected = run(["trace", "inspect", trace, "--json"]);
    expect(inspected.code).toBe(0);
    expect(inspected.lines[0].data.frames.length).toBeGreaterThan(0);
    const replayed = run(["trace", "replay", trace, "--json"]);
    expect(replayed.code).toBe(0);
    expect(replayed.lines[0].data.externalCalls).toBe(0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
