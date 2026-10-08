import { expect, it } from "vitest";
import { mkdtemp, readFile, writeFile, rm, access } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createStarter } from "../../packages/test-fixtures/src";
import {
  createProject,
  readProject,
} from "../../tools/blocky-cli/src/native-store";
import { projectDigest } from "../../packages/project-model/src";
import { dispatch } from "../../tools/blocky-cli/src/commands";
import { parse } from "../../tools/blocky-cli/src/arguments";
import { failure } from "../../tools/blocky-cli/src/protocol";
const run = (args: string[]) =>
  dispatch(parse([...args, "--json"]), () => {}, new AbortController().signal);

it("reports candidate field diagnostics without changing the source or writing a rejected patch", async () => {
  const root = await mkdtemp(resolve("try/cli-productivity-"));
  try {
    const file = join(root, "original.blocky"),
      edits = join(root, "edits.json"),
      patch = join(root, "rejected.json");
    await createProject(file, createStarter());
    const original = await readFile(file);
    await writeFile(
      edits,
      JSON.stringify([
        {
          op: "block.add",
          moduleId: "research-agent",
          blockId: "invalid-fixed-value",
          payload: {
            type: "core.data.set",
            id: "invalid-fixed-value",
            fields: { VALUE: "unquoted fixed text" },
          },
        },
      ]),
    );
    let rejected: unknown;
    try {
      await run([
        "patch",
        "create",
        file,
        "--operations",
        edits,
        "--output",
        patch,
      ]);
    } catch (error) {
      rejected = error;
    }
    expect(rejected).toBeDefined();
    const response = failure("patch.create", rejected);
    expect(response.exitCode).toBe(3);
    expect(response.result.error?.code).toBe("BLK-PATCH-004");
    expect(response.result.data).toMatchObject({
      diagnostics: expect.arrayContaining([
        expect.objectContaining({
          code: "BLK-TYPE-009",
          severity: "error",
          source: expect.objectContaining({ blockId: "invalid-fixed-value" }),
        }),
      ]),
    });
    expect(await readFile(file)).toEqual(original);
    await expect(access(patch)).rejects.toBeDefined();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("discovers actual input schemas and nested blocks without opening a window", async () => {
  const root = await mkdtemp(resolve("try/cli-productivity-"));
  try {
    const file = join(root, "original.blocky");
    await createProject(file, createStarter());
    const commands = await run(["command", "list", "--query", "patch"]);
    expect(JSON.stringify(commands.result.data)).toContain("patch create");
    const schema = await run(["schema", "show", "blocky.cli-operations/v1"]);
    expect(schema.result.data).toMatchObject({
      schema: { type: "array", maxItems: 500 },
    });
    const blocks = await run([
      "project",
      "block",
      "list",
      file,
      "--module",
      "citation-service",
      "--type",
      "core.knowledge.retrieve",
    ]);
    expect(blocks.result.data).toMatchObject({
      total: 1,
      blocks: [
        {
          blockId: "lookup-documents",
          parentId: "lookup-entry",
          connection: "input:BODY",
          fields: { RESOURCE: "product-handbook" },
        },
      ],
    });
    const shown = await run([
      "project",
      "block",
      "show",
      file,
      "--module",
      "citation-service",
      "--block",
      "lookup-documents",
    ]);
    expect(shown.result.data).toMatchObject({
      block: { blockId: "lookup-documents" },
      definition: { fields: ["RESOURCE"] },
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("completes batch review, apply, diff, checkpoint restore and compilation through CLI", async () => {
  const root = await mkdtemp(resolve("try/cli-productivity-"));
  try {
    const source = join(root, "source.blocky"),
      checkpoint = join(root, "checkpoint.blocky"),
      edits = join(root, "edits.json"),
      patch = join(root, "patch.json"),
      revised = join(root, "revised.blocky"),
      restored = join(root, "restored.blocky");
    await createProject(source, createStarter());
    const original = await readFile(source);
    await run(["project", "checkpoint", source, "--output", checkpoint]);
    await writeFile(
      edits,
      JSON.stringify([
        {
          op: "block.update",
          moduleId: "research-agent",
          blockId: "research-root",
          payload: { fields: { ROLE: "植物教师" } },
        },
        {
          op: "block.move",
          moduleId: "research-agent",
          blockId: "research-root",
          payload: { x: 220, y: 140 },
        },
      ]),
    );
    await run([
      "patch",
      "create",
      source,
      "--operations",
      edits,
      "--output",
      patch,
    ]);
    expect(
      (await run(["patch", "preview", source, "--patch", patch])).code,
    ).toBe(0);
    await run([
      "patch",
      "apply",
      source,
      "--patch",
      patch,
      "--output",
      revised,
    ]);
    const diff = await run(["project", "diff", source, revised]);
    expect(diff.result.data).toMatchObject({ same: false, total: 3 });
    const currentDigest = await projectDigest(await readProject(revised));
    await run([
      "project",
      "restore",
      revised,
      "--checkpoint",
      checkpoint,
      "--expect-digest",
      currentDigest,
      "--output",
      restored,
    ]);
    expect(await projectDigest(await readProject(restored))).toBe(
      await projectDigest(await readProject(source)),
    );
    expect((await run(["project", "compile", restored])).code).toBe(0);
    expect(await readFile(source)).toEqual(original);
    expect(await readFile(checkpoint)).toEqual(original);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("rejects partial batches, stale restore and overwrite without creating an output", async () => {
  const root = await mkdtemp(resolve("try/cli-productivity-"));
  try {
    const source = join(root, "source.blocky"),
      edits = join(root, "edits.json"),
      out = join(root, "out.json");
    await createProject(source, createStarter());
    const original = await readFile(source);
    await writeFile(
      edits,
      JSON.stringify([
        {
          op: "block.update",
          moduleId: "research-agent",
          blockId: "research-root",
          payload: { fields: { ROLE: "changed" } },
        },
        {
          op: "block.update",
          moduleId: "research-agent",
          blockId: "does-not-exist",
          payload: { fields: { ROLE: "changed" } },
        },
      ]),
    );
    await expect(
      run(["patch", "create", source, "--operations", edits, "--output", out]),
    ).rejects.toThrow();
    await expect(access(out)).rejects.toThrow();
    await expect(
      run([
        "project",
        "restore",
        source,
        "--checkpoint",
        source,
        "--expect-digest",
        "0".repeat(64),
        "--output",
        out,
      ]),
    ).rejects.toMatchObject({ code: "BLK-PATCH-001" });
    await expect(access(out)).rejects.toThrow();
    await expect(
      run(["project", "checkpoint", source, "--output", source]),
    ).rejects.toMatchObject({ exitCode: 5 });
    expect(await readFile(source)).toEqual(original);
    const advice = await run(["diagnostics", "explain", "BLK-PATCH-002"]);
    expect(JSON.stringify(advice.result.data)).toContain("schema show");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
