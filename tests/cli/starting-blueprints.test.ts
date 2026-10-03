import { expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { dispatch, help } from "../../tools/blocky-cli/src/commands";
import { parse } from "../../tools/blocky-cli/src/arguments";
import { readProject } from "../../tools/blocky-cli/src/native-store";
import { modelResource } from "../fixtures/model-resource";

const send = (argv: string[]) =>
  dispatch(parse(argv), () => {}, new AbortController().signal);

it("lists and shows the four editable starting blueprints in the public order", async () => {
  const listed = await send(["template", "list", "--json"]);
  expect(listed.code).toBe(0);
  const templates = (listed.result.data as { templates: { id: string }[] }).templates;
  expect(help.commands).toContain(
    "project create [--template <knowledge-assistant|work-assistant|coding-assistant|pi-agent>] [--model <resource-id>] [--name <name>] --output <file.blocky> --json",
  );
  expect(templates.map((item) => item.id)).toEqual([
    "knowledge-assistant",
    "work-assistant",
    "coding-assistant",
    "pi-agent",
  ]);

  for (const id of templates.map((item) => item.id)) {
    const shown = await send(["template", "show", id, "--json"]);
    expect(shown.code).toBe(0);
    const data = shown.result.data as {
      id: string;
      editable: boolean;
      project: { manifest: { displayName: string }; workspaces: Record<string, { blocks: { blocks: unknown[] } }> };
    };
    expect(data).toMatchObject({ id, editable: true });
    expect(data.project.manifest.displayName).toBeTruthy();
    expect(data.project.workspaces.main.blocks.blocks).not.toHaveLength(0);
  }
});

it("creates a configured starter with the local default model and honors an explicit override", async () => {
  await mkdir("try", { recursive: true });
  const root = await mkdtemp(resolve("try/cli-starting-blueprints-"));
  const previousProfile = process.env.BLOCKY_PROFILE_DIR;
  const previousLocal = process.env.LOCALAPPDATA;
  process.env.BLOCKY_PROFILE_DIR = join(root, "profile");
  process.env.LOCALAPPDATA = root;
  try {
    const primary = join(root, "primary.json");
    await writeFile(primary, JSON.stringify(modelResource("saved-model")));
    expect((await send(["resource", "set", "--definition", primary, "--json"])).code).toBe(0);
    expect((await send(["settings", "set", "--id", "models.defaultResourceId", "--value", '"saved-model"', "--json"])).code).toBe(0);

    const defaultFile = join(root, "default.blocky");
    const created = await send([
      "project", "create", "--template", "knowledge-assistant", "--name", "默认模型问答",
      "--output", defaultFile, "--json",
    ]);
    expect(created.code).toBe(0);
    const withDefault = await readProject(defaultFile);
    expect(withDefault.manifest.displayName).toBe("默认模型问答");
    expect(withDefault.manifest.resources).toContainEqual(expect.objectContaining({
      resourceId: "saved-model", kind: "model", scope: "user", definitionRef: "saved-model",
    }));
    expect(JSON.stringify(withDefault.workspaces)).toContain('"RESOURCE":"saved-model"');

    const alternate = join(root, "alternate.json");
    await writeFile(alternate, JSON.stringify(modelResource("other-model")));
    expect((await send(["resource", "set", "--definition", alternate, "--json"])).code).toBe(0);
    const explicitFile = join(root, "explicit.blocky");
    expect((await send([
      "project", "create", "--template", "coding-assistant", "--model", "other-model",
      "--output", explicitFile, "--json",
    ])).code).toBe(0);
    const withExplicit = await readProject(explicitFile);
    expect(withExplicit.manifest.resources).toContainEqual(expect.objectContaining({
      resourceId: "other-model", kind: "model", scope: "user", definitionRef: "other-model",
    }));
    expect(JSON.stringify(withExplicit.workspaces)).toContain('"RESOURCE":"other-model"');
    expect(JSON.stringify(withExplicit.workspaces)).not.toContain('"RESOURCE":"saved-model"');
  } finally {
    if (previousProfile === undefined) delete process.env.BLOCKY_PROFILE_DIR;
    else process.env.BLOCKY_PROFILE_DIR = previousProfile;
    if (previousLocal === undefined) delete process.env.LOCALAPPDATA;
    else process.env.LOCALAPPDATA = previousLocal;
    await rm(root, { recursive: true, force: true });
  }
});
