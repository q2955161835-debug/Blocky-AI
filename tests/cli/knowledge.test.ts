import { beforeAll, afterAll, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile, rm, readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createStarter } from "../../packages/test-fixtures/src";
import { createProject } from "../../tools/blocky-cli/src/native-store";
let directory: string, project: string, source: string;
beforeAll(async () => {
  await mkdir("try/stage3", { recursive: true });
  directory = await mkdtemp(resolve("try/stage3/cli-knowledge-"));
  project = join(directory, "source.blocky");
  source = join(directory, "lesson.txt");
  await writeFile(
    source,
    "水循环包含蒸发、凝结和降水。\n\nWater evaporates and returns as rain.",
    "utf8",
  );
  await createProject(project, createStarter());
});
afterAll(async () => {
  if (directory && resolve(directory).startsWith(resolve("try/stage3") + "\\"))
    await rm(directory, { recursive: true, force: true });
});
function cli(...args: string[]) {
  const run = spawnSync(
    process.execPath,
    [resolve("tools/blocky-cli/dist/main.mjs"), ...args, "--json"],
    {
      encoding: "utf8",
      timeout: 30000,
      windowsHide: true,
      env: { ...process.env, LOCALAPPDATA: directory, BLOCKY_PROFILE_DIR: join(directory, "ai.blocky.studio") },
    },
  );
  if (!run.stdout.trim()) throw Error(`CLI empty response: ${run.status}`);
  return { code: run.status, value: JSON.parse(run.stdout) };
}
it("uses native grants and persists incremental real ingestion across separate CLI processes", async () => {
  const added = cli(
    "knowledge",
    "add",
    project,
    "--collection",
    "lesson",
    "--kind",
    "file",
    "--path",
    source,
  );
  expect(added.code, JSON.stringify(added.value)).toBe(0);
  const id = added.value.data.sourceId;
  expect(JSON.stringify(added.value)).not.toContain(
    directory.replaceAll("\\", "\\\\"),
  );
  const sync = cli("knowledge", "sync", project, "--collection", "lesson");
  expect(sync.code, JSON.stringify(sync.value)).toBe(0);
  expect(sync.value.data.counts).toMatchObject({ added: 1, updated: 0 });
  expect(
    cli("knowledge", "sync", project, "--collection", "lesson").value.data
      .counts,
  ).toMatchObject({ skipped: 1 });
  await writeFile(source, "新的课堂资料。", "utf8");
  expect(
    cli("knowledge", "sync", project, "--collection", "lesson").value.data
      .counts,
  ).toMatchObject({ updated: 1 });
  const status = cli("knowledge", "status", project, "--collection", "lesson");
  expect(status.value.data).toMatchObject({
    documents: 1,
    chunks: 1,
    pending: null,
  });
  expect(
    cli(
      "knowledge",
      "access",
      project,
      "--collection",
      "lesson",
      "--source",
      id,
      "--access",
      "deny",
    ).code,
  ).toBe(0);
  expect(
    cli("knowledge", "status", project, "--collection", "lesson").value.data
      .chunks,
  ).toBe(0);
  expect(
    cli(
      "knowledge",
      "remove",
      project,
      "--collection",
      "lesson",
      "--source",
      id,
    ).code,
  ).toBe(0);
  expect(
    cli("knowledge", "sources", project, "--collection", "lesson").value.data
      .sources,
  ).toEqual([]);
});
it("binds a reference-only resource without changing the original project", async () => {
  const before = await readFile(project),
    output = join(directory, "bound.blocky");
  expect(
    cli(
      "knowledge",
      "bind",
      project,
      "--collection",
      "lesson",
      "--output",
      output,
    ).code,
  ).toBe(0);
  expect(await readFile(project)).toEqual(before);
  const inspected = cli("project", "inspect", output);
  expect(inspected.code).toBe(0);
  expect(
    cli(
      "knowledge",
      "bind",
      project,
      "--collection",
      "lesson",
      "--output",
      output,
    ).code,
  ).not.toBe(0);
});
