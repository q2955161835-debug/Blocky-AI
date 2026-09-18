import { beforeAll, afterAll, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { digest } from "../../packages/language-schema/src";
import { readProject } from "../../tools/blocky-cli/src/native-store";
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
      env: { ...process.env, LOCALAPPDATA: directory },
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
it("creates and reopens all four starters, runs real ingested evidence and switches a numeric tool", async () => {
  const source = join(directory, "lesson.ts");
  await writeFile(
    source,
    "// Water evaporates and returns as rain.\nexport const minutes = 15;\n",
  );
  const outputs: string[] = [];
  for (const id of [
    "research-companion",
    "code-guide",
    "knowledge-tutor",
    "task-helper",
  ]) {
    const file = join(directory, `${id}.blocky`);
    expect(
      cli("project", "create", "--template", id, "--output", file, "--json")
        .code,
    ).toBe(0);
    const project = await readProject(file);
    expect(
      blueprintInstance(project.workspaces["research-agent"].blocks.blocks[0])
        ?.blueprintId,
    ).toBe(`official-${id}`);
    if (id !== "task-helper") {
      expect(
        cli(
          "knowledge",
          "add",
          file,
          "--collection",
          "product-handbook",
          "--kind",
          "file",
          "--path",
          source,
          "--json",
        ).code,
      ).toBe(0);
      expect(
        cli(
          "knowledge",
          "sync",
          file,
          "--collection",
          "product-handbook",
          "--json",
        ).code,
      ).toBe(0);
    }
    const result = cli(
      "run",
      "start",
      file,
      "--simulate",
      "--input",
      id === "task-helper" ? '{"count":3,"minutes":15}' : "Water evaporates",
      "--jsonl",
    );
    expect(result.code, JSON.stringify(result.lines.at(-1))).toBe(0);
    const output = result.lines.at(-1).data;
    if (id === "task-helper") expect(output.answer).toBe("0.75");
    else {
      expect(output.citations[0].locator.path).toBe("lesson.ts");
      expect(output.answer).toContain("Water evaporates");
      outputs.push(output.answer);
    }
  }
  expect(new Set(outputs).size).toBe(3);
  const switched = join(directory, "minutes.blocky");
  expect(
    cli(
      "project",
      "configure",
      join(directory, "task-helper.blocky"),
      "--module",
      "research-agent",
      "--block",
      "call-citation",
      "--field",
      "MODULE",
      "--value",
      "minutes-service",
      "--output",
      switched,
      "--json",
    ).code,
  ).toBe(0);
  expect(
    cli(
      "run",
      "start",
      switched,
      "--simulate",
      "--input",
      '{"count":3,"minutes":15}',
      "--jsonl",
    ).lines.at(-1).data.answer,
  ).toBe("45");
});
it("exports an official blueprint, requires conflict resolution, and applies a native version update without clobbering originals", async () => {
  const source = join(directory, "task-helper.blocky"),
    custom = join(directory, "custom.blocky"),
    blueprint = join(directory, "official.json"),
    version2 = join(directory, "v2.json"),
    patch = join(directory, "update.json"),
    updated = join(directory, "updated.blocky");
  expect(
    cli("blueprint", "official", "task-helper", "--output", blueprint, "--json")
      .code,
  ).toBe(0);
  expect(
    cli(
      "project",
      "configure",
      source,
      "--module",
      "research-agent",
      "--block",
      "research-root",
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
    await readFile(blueprint, "utf8"),
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
    "research-root",
    "--output",
    patch,
    "--json",
  ];
  const unresolved = cli(...args);
  expect(unresolved.code).toBe(0);
  expect(unresolved.lines[0].data.ready).toBe(false);
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
    root = project.workspaces["research-agent"].blocks.blocks[0];
  expect(root.fields!.ROLE).toBe("我的自定义角色");
  expect(blueprintInstance(root)?.version).toBe(2);
  expect(
    [...walkBlocks([root])].find((b) => b.id === "call-citation")?.fields!
      .MODULE,
  ).toBe("citation-service");
});
