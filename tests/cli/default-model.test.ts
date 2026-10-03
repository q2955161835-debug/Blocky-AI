import { expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { readProject } from "../../tools/blocky-cli/src/native-store";
import { modelResource } from "../fixtures/model-resource";

it("persists the default across CLI processes and reuses it without granting model-call approval", async () => {
  await mkdir("try", { recursive: true });
  const root = await mkdtemp(resolve("try/cli-default-model-"));
  const cli = (...args: string[]) => {
    const run = spawnSync(process.execPath, [resolve("tools/blocky-cli/dist/main.mjs"), ...args, "--json"], {
      encoding: "utf8", timeout: 30000, windowsHide: true,
      env: { ...process.env, BLOCKY_PROFILE_DIR: join(root, "profile") },
    });
    return { code: run.status, value: JSON.parse(run.stdout) };
  };
  try {
    const before = join(root, "before.blocky"), after = join(root, "after.blocky");
    expect(cli("project", "create", "--name", "创建前空白项目", "--output", before).code).toBe(0);
    const original = await readFile(before);
    const beforeProject = await readProject(before);
    expect(beforeProject.manifest.modules.map((module) => module.moduleId)).toEqual(["main"]);
    expect(beforeProject.manifest.resources).toEqual([]);
    expect(beforeProject.workspaces.main.blocks.blocks).toEqual([]);
    const definition = join(root, "model.json"), envFile = join(root, "fixture.env");
    await writeFile(definition, JSON.stringify(modelResource()));
    await writeFile(envFile, "TEST_MODEL_KEY=synthetic-test-only\n");
    expect(cli("resource", "set", "--definition", definition).code).toBe(0);
    expect(cli("secret", "import", "--id", "saved-model-secret", "--env-file", envFile, "--variable", "TEST_MODEL_KEY").code).toBe(0);
    expect(cli("settings", "set", "--id", "models.defaultResourceId", "--value", '"saved-model"').code).toBe(0);
    expect(cli("settings", "list").value.data.settings.values["models.defaultResourceId"]).toBe("saved-model");
    expect(cli("project", "create", "--name", "设置后空白项目", "--output", after).code).toBe(0);
    const project = await readProject(after);
    expect(project.manifest.modules.map((module) => module.moduleId)).toEqual(["main"]);
    expect(project.workspaces.main.blocks.blocks).toEqual([]);
    expect(project.manifest.resources).toEqual([]);
    expect(JSON.stringify(project.workspaces)).not.toContain('"RESOURCE":"saved-model"');
    expect(project.resources["saved-model"]).toBeUndefined();
    expect(await readFile(before)).toEqual(original);
    const preview = cli("builder", "draft", after, "--module", "main", "--prompt", "Explain this project", "--live", "--request-id", "default-preview", "--output", join(root, "candidate.json"));
    expect(preview.code).toBe(4);
    expect(preview.value.data).toMatchObject({ modelApiCalled: false, pendingApproval: { modelId: "deepseek-v4-pro" } });
    expect(JSON.stringify(preview.value)).not.toContain("synthetic-test-only");
    const alternative = { ...modelResource("other-model"), definition: { ...modelResource().definition, modelId: "other-model-id" } };
    await writeFile(definition, JSON.stringify(alternative));
    expect(cli("resource", "set", "--definition", definition).code).toBe(0);
    const explicit = cli("builder", "draft", after, "--module", "main", "--prompt", "Explain this project", "--live", "--model", "other-model", "--request-id", "explicit-preview", "--output", join(root, "explicit.json"));
    expect(explicit.code).toBe(4);
    expect(explicit.value.data.pendingApproval.modelId).toBe("other-model-id");
    expect(cli("settings", "set", "--id", "models.defaultResourceId", "--value", '"not-configured"').code).toBe(3);
    expect(cli("resource", "delete", "--id", "saved-model").code).toBe(0);
    const unavailable = cli("builder", "draft", after, "--module", "main", "--prompt", "Explain this project", "--live", "--request-id", "missing-default", "--output", join(root, "missing-preview.json"));
    expect(unavailable.code).toBe(3);
    expect(unavailable.value.error.code).toBe("BLK-MODEL-DEFAULT-001");
    const stillBlank = join(root, "missing-default.blocky");
    expect(cli("project", "create", "--output", stillBlank).code).toBe(0);
    expect((await readProject(stillBlank)).manifest.resources).toEqual([]);
    expect(cli("settings", "reset", "--id", "models.defaultResourceId").code).toBe(0);
    const reset = join(root, "reset.blocky");
    expect(cli("project", "create", "--output", reset).code).toBe(0);
    expect((await readProject(reset)).manifest.resources).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 60000);
