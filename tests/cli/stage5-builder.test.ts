import { expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createStarter } from "../../packages/test-fixtures/src";
import { createProject } from "../../tools/blocky-cli/src/native-store";
import { dispatch } from "../../tools/blocky-cli/src/commands";
import { parse } from "../../tools/blocky-cli/src/arguments";
import fixture from "../contracts/fixtures/generated-surface.json";

it("CLI inspects and drafts through the shared builder and preserves the original archive", async () => {
  const root = await mkdtemp(resolve("try/stage5-cli-"));
  try {
    const file = join(root, "original.blocky"),
      candidate = join(root, "candidate.json");
    await createProject(file, createStarter());
    const before = await readFile(file);
    const run = (args: string[]) =>
      dispatch(parse(args), () => {}, new AbortController().signal);
    const inspected = await run([
      "builder",
      "inspect",
      file,
      "--module",
      "research-agent",
      "--json",
    ]);
    expect(inspected.code).toBe(0);
    const drafted = await run([
      "builder",
      "draft",
      file,
      "--module",
      "research-agent",
      "--prompt",
      "植物教学助手",
      "--output",
      candidate,
      "--json",
    ]);
    expect(drafted.code).toBe(0);
    const result = JSON.parse(await readFile(candidate, "utf8"));
    expect(result.patch.operations.length).toBeGreaterThan(0);
    expect(result.modelApiCalled).toBe(false);
    const evidence = await run(["builder", "evidence", "--request-id", result.requestId, "--json"]);
    expect(evidence.result.data).toMatchObject({requestId:result.requestId,outcome:"completed",attempts:[]});
    const workInput = join(root, "work-input.json"),
      workCandidate = join(root, "work-candidate.json");
    await writeFile(
      workInput,
      JSON.stringify({
        schemaVersion: "blocky.work-input/v1",
        request: {
          schemaVersion: "blocky.builder-request/v1",
          requestId: "work-cli-test",
          projectId: createStarter().manifest.projectId,
          moduleId: "research-agent",
          intent: "build",
          prompt: "植物教学助手",
          selection: [],
          createSurface: false,
        },
        operations: result.patch.operations,
      }),
    );
    expect(
      (
        await run([
          "builder",
          "work",
          "create-blocky-blocks",
          file,
          "--input",
          workInput,
          "--output",
          workCandidate,
          "--json",
        ])
      ).code,
    ).toBe(0);
    expect(
      (
        await run([
          "patch",
          "apply",
          file,
          "--patch",
          workCandidate,
          "--output",
          join(root, "work-accepted.blocky"),
          "--json",
        ])
      ).code,
    ).toBe(0);
    expect(
      (
        await run([
          "builder",
          "verify",
          file,
          "--candidate",
          candidate,
          "--json",
        ])
      ).code,
    ).toBe(0);
    expect(await readFile(file)).toEqual(before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 30000);
it("creates, rejects permissionless apply, accepts and builds generated source through the native archive", async () => {
  const root = await mkdtemp(resolve("try/stage5-surface-cli-"));
  try {
    const file = join(root, "original.blocky"),
      spec = join(root, "spec.json"),
      patch = join(root, "patch.json"),
      accepted = join(root, "accepted.blocky"),
      html = join(root, "page.html");
    await createProject(file, createStarter());
    const before = await readFile(file);
    await writeFile(
      spec,
      JSON.stringify(
        fixture.draft.files[
          "surfaces/surface-generated-contract/surface-spec.json"
        ],
      ),
    );
    const run = (args: string[]) =>
      dispatch(parse(args), () => {}, new AbortController().signal);
    expect(
      (
        await run([
          "surface",
          "create",
          file,
          "--module",
          "research-agent",
          "--spec",
          spec,
          "--output",
          patch,
          "--json",
        ])
      ).code,
    ).toBe(0);
    await expect(
      run([
        "patch",
        "apply",
        file,
        "--patch",
        patch,
        "--output",
        accepted,
        "--json",
      ]),
    ).rejects.toThrow();
    const candidate = JSON.parse(await readFile(patch, "utf8"));
    expect(
      (
        await run([
          "patch",
          "apply",
          file,
          "--patch",
          patch,
          "--approve-permissions",
          candidate.permissionDelta.join(","),
          "--output",
          accepted,
          "--json",
        ])
      ).code,
    ).toBe(0);
    expect(
      (
        await run([
          "surface",
          "build",
          accepted,
          "--surface-id",
          candidate.operations[0].manifest.surfaceId,
          "--output",
          html,
          "--json",
        ])
      ).code,
    ).toBe(0);
    expect(await readFile(html, "utf8")).toContain("设备报修");
    expect(await readFile(file)).toEqual(before);
    const request = join(root, "invalid.json");
    await writeFile(request, JSON.stringify({ schemaVersion: "bad" }));
    for (const work of [
      "build-blocky-agents",
      "create-blocky-blocks",
      "convert-github-project-to-blocky",
      "reverse-agent-to-blocky",
    ])
      await expect(
        run([
          "builder",
          "work",
          work,
          file,
          "--input",
          request,
          "--output",
          join(root, `${work}.json`),
          "--json",
        ]),
      ).rejects.toThrow();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 30000);
