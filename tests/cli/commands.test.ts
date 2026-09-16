import { afterAll, beforeAll, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile, copyFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { compileProject } from "../../packages/compiler/src";
import {
  readProject,
  createProject,
} from "../../tools/blocky-cli/src/native-store";
import { createStarter } from "../../packages/test-fixtures/src";
import { digest } from "../../packages/language-schema/src";
const cli = resolve("tools/blocky-cli/dist/main.mjs");
let directory: string, file: string;
function run(args: string[]) {
  const p = spawnSync(process.execPath, [cli, ...args], {
    encoding: "utf8",
    timeout: 20000,
    windowsHide: true,
  });
  return {
    code: p.status,
    lines: p.stdout
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line)),
    stderr: p.stderr,
  };
}
const hash = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
beforeAll(async () => {
  directory = await mkdtemp(resolve("try/cli-test-"));
  file = join(directory, "research.blocky");
});
afterAll(async () => {
  if (directory.startsWith(resolve("try/cli-test-")))
    await rm(directory, { recursive: true, force: true });
});
it("reports only implemented commands and a real native store version", () => {
  const h = run(["--help"]);
  expect(h.code).toBe(0);
  expect(h.lines[0].schemaVersion).toBe("blocky.cli/v1");
  expect(h.lines[0].data.commands).not.toContain("compat export");
  const doctor = run(["doctor", "--json"]);
  expect(doctor.code).toBe(0);
  expect(doctor.lines[0].data.nativeStore).toBe("0.1.0");
  expect(doctor.lines[0].data.modelApiCalled).toBe(false);
});
it("creates a real archive and refuses to clobber the same target", async () => {
  const created = run([
    "project",
    "create",
    "--template",
    "research-companion",
    "--output",
    file,
    "--json",
  ]);
  expect(created.code).toBe(0);
  const bytes = await readFile(file);
  expect(bytes.subarray(0, 2).toString()).toBe("PK");
  expect(created.lines[0].artifacts[0].sha256).toBe(hash(bytes));
  const conflict = run([
    "project",
    "create",
    "--template",
    "research-companion",
    "--output",
    file,
    "--json",
  ]);
  expect(conflict.code).toBe(5);
  expect(hash(await readFile(file))).toBe(hash(bytes));
  expect(conflict.lines[0].error.code).toBe("BLK-CONFLICT-001");
});
it("compiles with the exact desktop compiler and does not rewrite project bytes", async () => {
  const before = hash(await readFile(file));
  const direct = await compileProject(await readProject(file));
  const compiled = run(["project", "compile", file, "--json"]);
  expect(compiled.code).toBe(0);
  expect(compiled.lines[0].data.digest).toBe(await digest(direct.ir));
  expect(compiled.lines[0].data.interaction).toEqual(direct.interaction);
  expect(hash(await readFile(file))).toBe(before);
  expect(run(["project", "validate", file, "--json"]).code).toBe(0);
  expect(
    run(["project", "module", "list", file, "--json"]).lines[0].data.modules,
  ).toHaveLength(2);
  expect(
    run(["surface", "list", file, "--json"]).lines[0].data.surfaces,
  ).toEqual([]);
});
it("requires explicit simulation and streams actual runtime events plus sourced answer", () => {
  expect(run(["run", "start", file, "--input", "树叶", "--jsonl"]).code).toBe(
    2,
  );
  expect(run(["run", "start", file, "--live", "--jsonl"]).code).toBe(4);
  const result = run([
    "run",
    "start",
    file,
    "--simulate",
    "--input",
    "为什么树叶变黄",
    "--jsonl",
  ]);
  expect(result.code).toBe(0);
  const events = result.lines.slice(0, -1);
  expect(events[0].type).toBe("run.started");
  expect(events.at(-1).type).toBe("run.completed");
  expect(
    events.every(
      (e, i) =>
        e.eventVersion === "blocky.event/v1alpha1" &&
        (i === 0 || e.sequence > events[i - 1].sequence),
    ),
  ).toBe(true);
  const answer = result.lines.at(-1).data;
  expect(answer.citations[0].id).toBe("leaves");
  expect(answer.answer).toContain("叶绿素");
  expect(answer.modelApiCalled).toBe(false);
});
it("returns stable failures without reflecting unknown arguments or paths", async () => {
  const marker = "FICTIONAL_PRIVATE_MARKER";
  const unknown = run([marker, "--json"]);
  expect(unknown.code).toBe(2);
  expect(JSON.stringify(unknown)).not.toContain(marker);
  const corrupt = join(directory, marker + ".blocky");
  await writeFile(corrupt, "bad archive");
  const failed = run(["project", "validate", corrupt, "--json"]);
  expect(failed.code).toBe(3);
  expect(JSON.stringify(failed)).not.toContain(marker);
  expect(run(["catalog", "list", "--limit", "-1", "--json"]).code).toBe(2);
});
it("paginates the catalog and rejects unknown options instead of ignoring them", () => {
  const first = run(["catalog", "list", "--limit", "2", "--json"]).lines[0];
  expect(first.data.blocks).toHaveLength(2);
  expect(first.nextCursor).toBe("2");
  const second = run([
    "catalog",
    "list",
    "--limit",
    "2",
    "--cursor",
    first.nextCursor,
    "--json",
  ]).lines[0];
  expect(second.data.blocks[0].type).not.toBe(first.data.blocks[0].type);
  expect(
    run(["catalog", "list", "--ignore-errors", "true", "--json"]).code,
  ).toBe(2);
});
it("cancels on its declared deadline with no subsequent execution events", () => {
  const result = run([
    "run",
    "start",
    file,
    "--simulate",
    "--input",
    "水循环",
    "--timeout",
    "1",
    "--jsonl",
  ]);
  expect(result.code).toBe(7);
  expect(result.lines.at(-2).type).toBe("run.cancelled");
  expect(result.lines.at(-1).data.status).toBe("cancelled");
  expect(result.lines.filter((e) => e.type === "run.completed")).toHaveLength(
    0,
  );
});
it("fails explicitly when the installed native companion is absent", async () => {
  const isolated = join(directory, "main.mjs");
  await copyFile(cli, isolated);
  const result = spawnSync(process.execPath, [isolated, "doctor", "--json"], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 10000,
  });
  expect(result.status).toBe(6);
  expect(JSON.parse(result.stdout).error.code).toBe("BLK-CLI-006");
});
it("redacts path-bearing user labels on stdout without changing the saved project", async () => {
  const p = createStarter();
  p.manifest.displayName = "C:\\FICTIONAL_PRIVATE_FOLDER\\private-document";
  const target = join(directory, "label.blocky");
  await createProject(target, p);
  const result = run(["project", "inspect", target, "--json"]);
  expect(result.code).toBe(0);
  expect(JSON.stringify(result.lines)).not.toContain(
    "FICTIONAL_PRIVATE_FOLDER",
  );
  expect(result.lines[0].warnings.length).toBeGreaterThan(0);
  expect((await readProject(target)).manifest.displayName).toBe(
    p.manifest.displayName,
  );
});
