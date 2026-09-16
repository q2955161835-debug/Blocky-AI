import { it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createStarter } from "../../packages/test-fixtures/src";
import {
  createProject,
  readProject,
  applyProjectPatch,
} from "../../tools/blocky-cli/src/native-store";
import { makePatch } from "../../packages/builder-protocol/src";
import { surfaceFromProject } from "../../packages/app-surface/src";
it("creates reviewable surface files via CLI, rejects missing permission and tampering, and reopens through native storage", async () => {
  const dir = await mkdtemp(resolve("try/surface-cli-"));
  const cli = (...args: string[]) => {
    const p = spawnSync(
      process.execPath,
      [resolve("tools/blocky-cli/dist/main.mjs"), ...args, "--json"],
      { encoding: "utf8", windowsHide: true, timeout: 20000 },
    );
    return { code: p.status, value: JSON.parse(p.stdout) };
  };
  try {
    const input = join(dir, "input.blocky"),
      patch = join(dir, "surface.json"),
      output = join(dir, "output.blocky");
    await createProject(input, createStarter());
    expect(
      cli(
        "surface",
        "create",
        input,
        "--module",
        "research-agent",
        "--output",
        patch,
      ).code,
    ).toBe(0);
    expect((await readProject(input)).manifest.appSurfaces).toHaveLength(0);
    const candidate = JSON.parse(await readFile(patch, "utf8"));
    expect(
      cli("patch", "preview", input, "--patch", patch).value.data
        .permissionDelta,
    ).toEqual(["surface.invoke.ask", "surface.preview"]);
    expect(
      cli("patch", "apply", input, "--patch", patch, "--output", output).code,
    ).toBe(3);
    expect(
      cli(
        "patch",
        "apply",
        input,
        "--patch",
        patch,
        "--output",
        output,
        "--approve-permissions",
        candidate.permissionDelta.join(","),
      ).code,
    ).toBe(0);
    const project = await readProject(output),
      surface = surfaceFromProject(
        project,
        project.manifest.appSurfaces[0].surfaceId,
      );
    expect(
      surface.files[`${surface.manifest.sourceRootRef}/page.html`],
    ).toContain("<html");
    const follow = await makePatch(project, [
      {
        op: "block.move",
        moduleId: "research-agent",
        blockId: project.workspaces["research-agent"].blocks.blocks[0].id,
        payload: { x: 100, y: 100 },
      },
    ]);
    await applyProjectPatch(
      output,
      join(dir, "edited.blocky"),
      project,
      follow,
      [],
    );
    expect(
      (await readProject(join(dir, "edited.blocky"))).manifest.appSurfaces,
    ).toHaveLength(1);
    candidate.operations[0].files[`${surface.manifest.sourceRootRef}/page.js`] =
      "fetch('https://example.com')";
    await writeFile(patch, JSON.stringify(candidate));
    expect(
      cli(
        "patch",
        "apply",
        input,
        "--patch",
        patch,
        "--output",
        join(dir, "bad.blocky"),
        "--approve-permissions",
        candidate.permissionDelta.join(","),
      ).code,
    ).toBe(3);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
