import { beforeAll, afterAll, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { digest } from "../../packages/language-schema/src";
import { createProject, readProject } from "../../tools/blocky-cli/src/native-store";
import { createStarter } from "../../packages/test-fixtures/src";
import {
  blueprintInstance,
  walkBlocks,
} from "../../packages/block-catalog/src";
let directory: string;
beforeAll(async () => {
  await mkdir("try/stage3", { recursive: true });
  directory = await mkdtemp(resolve("try/stage3/cli-blueprints-"));
});
afterAll(async () => {
  if (directory?.startsWith(resolve("try/stage3") + "\\"))
    await rm(directory, { recursive: true, force: true });
});
function cli(...args: string[]) {
  const p = spawnSync(
    process.execPath,
    [resolve("tools/blocky-cli/dist/main.mjs"), ...args],
    {
      encoding: "utf8",
      windowsHide: true,
      timeout: 30000,
      env: { ...process.env, LOCALAPPDATA: directory, BLOCKY_PROFILE_DIR: join(directory, "ai.blocky.studio") },
    },
  );
  return {
    code: p.status,
    lines: p.stdout
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((s) => JSON.parse(s)),
  };
}
it("captures, inserts, updates and restores a personal blueprint with explicit conflict handling", async () => {
  const source = join(directory, "source.blocky"),
    personal = join(directory, "personal.json"),
    inserted = join(directory, "inserted.blocky"),
    custom = join(directory, "custom.blocky"),
    version2 = join(directory, "v2.json"),
    patch = join(directory, "update.json"),
    updated = join(directory, "updated.blocky"),
    restorePatch = join(directory, "restore.json"),
    restored = join(directory, "restored.blocky");
  await createProject(source, createStarter());
  const sourceBytes = await readFile(source);
  const captured = cli(
    "blueprint",
    "create",
    source,
    "--module",
    "research-agent",
    "--blocks",
    "research-root",
    "--name",
    "我的问答",
    "--output",
    personal,
    "--json",
  );
  expect(captured.code).toBe(0);
  expect(cli("blueprint", "show", personal, "--json").code).toBe(0);
  expect(
    cli(
      "blueprint",
      "insert",
      source,
      "--blueprint",
      personal,
      "--module",
      "research-agent",
      "--reuse-bindings",
      "--output",
      inserted,
      "--json",
    ).code,
  ).toBe(0);
  const insertedProject = await readProject(inserted);
  const instanceRoot = insertedProject.workspaces["research-agent"].blocks.blocks.find(
    (root) => blueprintInstance(root)?.blueprintId === captured.lines[0].data.blueprintId,
  );
  expect(instanceRoot).toBeTruthy();
  const rootId = instanceRoot!.id;
  expect(
    cli(
      "project",
      "configure",
      inserted,
      "--module",
      "research-agent",
      "--block",
      rootId,
      "--field",
      "ROLE",
      "--value",
      "我的自定义角色",
      "--output",
      custom,
      "--json",
    ).code,
  ).toBe(0);
  const { digest: _, ...content } = JSON.parse(
    await readFile(personal, "utf8"),
  );
  content.version = 2;
  content.roots[0].fields.ROLE = "新的官方角色";
  content.parameters[0].defaultValue = "新的官方角色";
  await writeFile(
    version2,
    JSON.stringify({ ...content, digest: await digest(content) }),
  );
  const original = await readFile(custom);
  const args = [
    "blueprint",
    "update",
    custom,
    "--blueprint",
    version2,
    "--module",
    "research-agent",
    "--root",
    rootId,
    "--output",
    patch,
    "--json",
  ];
  const unresolved = cli(...args);
  expect(unresolved.code).toBe(0);
  expect(unresolved.lines[0].data.ready).toBe(false);
  expect(unresolved.lines[0].data.conflicts.length).toBeGreaterThan(0);
  expect(cli(...args, "--resolution", "keep-user").code).toBe(0);
  expect(
    cli(
      "patch",
      "apply",
      custom,
      "--patch",
      patch,
      "--output",
      updated,
      "--json",
    ).code,
  ).toBe(0);
  expect(await readFile(custom)).toEqual(original);
  const project = await readProject(updated),
    root = project.workspaces["research-agent"].blocks.blocks.find((block) => block.id === rootId)!;
  expect(root.fields!.ROLE).toBe("我的自定义角色");
  const updatedInstance = blueprintInstance(root)!;
  expect(updatedInstance.version).toBe(2);
  expect(
    [...walkBlocks([root])].find((b) => b.id === updatedInstance.idMap["call-citation"])?.fields!.MODULE,
  ).toBe("citation-service");
  const restore = cli(
    "blueprint",
    "restore",
    updated,
    "--blueprint",
    version2,
    "--module",
    "research-agent",
    "--root",
    rootId,
    "--output",
    restorePatch,
    "--json",
  );
  expect(restore.code).toBe(0);
  expect(
    cli(
      "patch",
      "apply",
      updated,
      "--patch",
      restorePatch,
      "--output",
      restored,
      "--json",
    ).code,
  ).toBe(0);
  const final = await readProject(restored);
  expect(
    final.workspaces["research-agent"].blocks.blocks.find((block) => block.id === rootId)?.fields!.ROLE,
  ).toBe("新的官方角色");
  expect(await readFile(source)).toEqual(sourceBytes);
});
