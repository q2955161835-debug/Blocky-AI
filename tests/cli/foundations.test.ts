import { beforeAll, afterAll, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import {
  readProject,
  createProject,
} from "../../tools/blocky-cli/src/native-store";
import { createTextProject } from "../../packages/test-fixtures/src/text-project";
let directory: string;
beforeAll(async () => {
  await mkdir("try", { recursive: true });
  directory = await mkdtemp(resolve("try/cli-stage2-"));
});
afterAll(async () => {
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
      env: { ...process.env, LOCALAPPDATA: directory },
    },
  );
  return { code: run.status, value: JSON.parse(run.stdout) };
}
it("creates and renames modules, roundtrips project settings, and preserves output conflicts", async () => {
  const source = join(directory, "source.blocky"),
    newCanvas = join(directory, "canvas.blocky"),
    renamed = join(directory, "renamed.blocky"),
    settings = join(directory, "settings.blocky");
  expect(
    cli(
      "project",
      "create",
      "--template",
      "research-companion",
      "--output",
      source,
    ).code,
  ).toBe(0);
  expect(
    cli(
      "project",
      "module",
      "create",
      source,
      "--id",
      "extra-module",
      "--name",
      "额外画布",
      "--output",
      newCanvas,
    ).code,
  ).toBe(0);
  expect(
    cli(
      "project",
      "module",
      "rename",
      newCanvas,
      "--id",
      "extra-module",
      "--name",
      "重命名",
      "--output",
      renamed,
    ).code,
  ).toBe(0);
  const p = await readProject(renamed);
  expect(
    p.manifest.modules.find((m) => m.moduleId === "extra-module")?.displayName,
  ).toBe("重命名");
  expect(
    cli(
      "project",
      "settings",
      "set",
      renamed,
      "--id",
      "terminal.outputBudgetBytes",
      "--value",
      "4096",
      "--output",
      settings,
    ).code,
  ).toBe(0);
  expect(
    (await readProject(settings)).settings?.values[
      "terminal.outputBudgetBytes"
    ],
  ).toBe(4096);
  const before = await readFile(settings);
  expect(
    cli(
      "project",
      "settings",
      "reset",
      settings,
      "--id",
      "terminal.outputBudgetBytes",
      "--output",
      settings,
    ).code,
  ).toBe(5);
  expect(await readFile(settings)).toEqual(before);
  expect(
    cli(
      "project",
      "settings",
      "set",
      settings,
      "--id",
      "ui.view",
      "--value",
      '"beginner"',
      "--output",
      join(directory, "denied.blocky"),
    ).code,
  ).toBe(3);
  await expect(readFile(join(directory, "denied.blocky"))).rejects.toThrow();
});
// Keep the suite's aggregate budget for the multiple CLI and native helper launches.
it("stores scoped configuration outside projects and protects conflicts and secrets", { timeout: 60_000 }, async () => {
  expect(
    cli("settings", "set", "--id", "ui.view", "--value", '"beginner"').code,
  ).toBe(0);
  expect(cli("settings", "list").value.data.settings.values["ui.view"]).toBe(
    "beginner",
  );
  expect(
    cli("shortcuts", "set", "--id", "file.save", "--keys", '["Ctrl+O"]').code,
  ).toBe(3);
  expect(
    cli("shortcuts", "set", "--id", "file.save", "--keys", '["Ctrl+Alt+S"]')
      .code,
  ).toBe(0);
  expect(
    cli("shortcuts", "export", "--output", join(directory, "keys.json")).code,
  ).toBe(0);
  const source = await readProject(join(directory, "source.blocky"));
  const resource = structuredClone(
    Object.values(source.resources).find((r) => r.kind === "model")!,
  );
  resource.scope = "user";
  resource.resourceId = "user-composer";
  const resourceFile = join(directory, "resource.json");
  await writeFile(resourceFile, JSON.stringify(resource));
  expect(cli("resource", "set", "--definition", resourceFile).code).toBe(0);
  expect(cli("resource", "list").value.data.resources).toContainEqual(resource);
  const linked = join(directory, "linked.blocky");
  const linkedResult = cli(
    "project",
    "resource",
    "link-user",
    join(directory, "source.blocky"),
    "--id",
    "user-composer",
    "--output",
    linked,
  );
  expect(linkedResult.code, JSON.stringify(linkedResult.value)).toBe(0);
  expect(
    (await readProject(linked)).resources["user-composer"],
  ).toBeUndefined();
  const configured = join(directory, "configured.blocky"),
    patch = join(directory, "user-surface.json"),
    surfaced = join(directory, "surfaced.blocky");
  expect(
    cli(
      "project",
      "configure",
      linked,
      "--module",
      "research-agent",
      "--block",
      "compose-answer",
      "--field",
      "RESOURCE",
      "--value",
      "user-composer",
      "--output",
      configured,
    ).code,
  ).toBe(0);
  const draft = cli(
    "surface",
    "create",
    configured,
    "--module",
    "research-agent",
    "--output",
    patch,
  );
  expect(draft.code, JSON.stringify(draft.value)).toBe(0);
  const applied = cli(
    "patch",
    "apply",
    configured,
    "--patch",
    patch,
    "--approve-permissions",
    "surface.preview,surface.invoke.ask",
    "--output",
    surfaced,
  );
  expect(applied.code, JSON.stringify(applied.value)).toBe(0);
  const env = join(directory, ".env");
  await writeFile(env, "FAKE=synthetic-cli-canary-stage2\n");
  const imported = cli(
    "secret",
    "import",
    "--id",
    "synthetic-ref",
    "--env-file",
    env,
    "--variable",
    "FAKE",
  );
  expect(imported.code).toBe(0);
  expect(JSON.stringify(imported.value)).not.toContain("synthetic-cli-canary");
  expect(
    cli("secret", "status", "--id", "synthetic-ref").value.data.configured,
  ).toBe(true);
  const cipher = await readFile(
    join(directory, "ai.blocky.studio/secrets/synthetic-ref.bin"),
  );
  expect(cipher.includes(Buffer.from("synthetic-cli-canary-stage2"))).toBe(
    false,
  );
  expect(cli("secret", "remove", "--id", "synthetic-ref").code).toBe(0);
  expect(
    cli(
      "task",
      "run",
      linked,
      "--task",
      "blocky.project-inventory",
      "--limit",
      "10",
    ).code,
  ).toBe(0);
});
it("roundtrips structured JSON text primitives through native blueprint application", async () => {
  const source = join(directory, "text.blocky"),
    blueprint = join(directory, "text-blueprint.json"),
    output = join(directory, "text-inserted.blocky");
  await createProject(source, createTextProject({ nested: [1, true, null] }));
  expect(
    cli(
      "blueprint",
      "create",
      source,
      "--module",
      "main",
      "--blocks",
      "agent-one",
      "--name",
      "文本蓝图",
      "--output",
      blueprint,
    ).code,
  ).toBe(0);
  const inserted = cli(
    "blueprint",
    "insert",
    source,
    "--blueprint",
    blueprint,
    "--module",
    "main",
    "--reuse-bindings",
    "--output",
    output,
  );
  expect(inserted.code, JSON.stringify(inserted.value)).toBe(0);
  expect(
    (await readProject(output)).workspaces.main.blocks.blocks,
  ).toHaveLength(2);
});
