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
import packageInfo from "../../package.json";
import { digest } from "../../packages/language-schema/src";
import { canonicalJson } from "../../packages/language-schema/src";
import { makePatch } from "../../packages/builder-protocol/src";
import { encodeProject } from "../../packages/project-format/src";
const cli = resolve("tools/blocky-cli/dist/main.mjs");
const native = resolve("tools/blocky-cli/dist/bin/blocky-project-io.exe");
function nativeRequest(value: object) {
  const child = spawnSync(native, [], {
    input: JSON.stringify({
      schemaVersion: "blocky.project-io/v1alpha1",
      ...value,
    }),
    encoding: "utf8",
    windowsHide: true,
    timeout: 20000,
  });
  return { code: child.status, value: JSON.parse(child.stdout) };
}
it("has an independent native patch gate for stale bases, capability grants and safe output", async () => {
  const project = createStarter();
  project.resources["product-handbook"].capabilityRequirements = [
    "private.read",
  ];
  project.workspaces[
    "citation-service"
  ].blocks.blocks[0].inputs!.BODY.block!.disabled = true;
  const patch = await makePatch(project, [
    {
      op: "block.add",
      moduleId: "research-agent",
      blockId: "guard-query",
      payload: {
        type: "core.knowledge.retrieve",
        id: "guard-query",
        fields: { RESOURCE: "product-handbook" },
      },
    },
  ]);
  const base = {
    operation: "validate-patch",
    originalJson: canonicalJson(project),
    patch,
  };
  expect(nativeRequest({ ...base, approved: [] }).value.code).toBe(
    "BLK-PATCH-003",
  );
  expect(nativeRequest({ ...base, approved: patch.permissionDelta }).code).toBe(
    0,
  );
  expect(
    nativeRequest({
      ...base,
      patch: { ...patch, baseDigest: "0".repeat(64) },
      approved: patch.permissionDelta,
    }).value.code,
  ).toBe("BLK-PATCH-001");
  const input = join(directory, "native-base.blocky"),
    target = join(directory, "native-patch.blocky");
  expect(
    nativeRequest({
      operation: "create",
      path: input,
      files: encodeProject(project),
    }).code,
  ).toBe(0);
  expect(
    nativeRequest({
      ...base,
      operation: "apply-patch",
      source: input,
      path: target,
      approved: [],
    }).value.code,
  ).toBe("BLK-PATCH-003");
  await expect(readFile(target)).rejects.toThrow();
  expect(
    nativeRequest({
      ...base,
      operation: "apply-patch",
      source: input,
      path: target,
      approved: patch.permissionDelta,
    }).code,
  ).toBe(0);
  const bytes = await readFile(target);
  expect(
    nativeRequest({
      ...base,
      operation: "apply-patch",
      source: input,
      path: target,
      approved: patch.permissionDelta,
    }).value.code,
  ).toBe("BLK-CONFLICT-001");
  expect(await readFile(target)).toEqual(bytes);
  const attack = join(directory, "untrusted-patch.json");
  await writeFile(
    attack,
    JSON.stringify({
      ...patch,
      diagnostics: [{ apiKey: "TEST_MARKER_NOT_A_KEY" }],
    }),
  );
  const rejected = run([
    "patch",
    "preview",
    input,
    "--patch",
    attack,
    "--json",
  ]);
  expect(rejected.code).toBe(3);
  expect(JSON.stringify(rejected.lines)).not.toContain("TEST_MARKER_NOT_A_KEY");
});
let directory: string, file: string, blankFile: string;
function run(args: string[]) {
  const p = spawnSync(process.execPath, [cli, ...args], {
    encoding: "utf8",
    timeout: 20000,
    windowsHide: true,
    env: { ...process.env, LOCALAPPDATA: directory, BLOCKY_PROFILE_DIR: join(directory, "ai.blocky.studio") },
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
  blankFile = join(directory, "blank.blocky");
  await createProject(file, createStarter());
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
  expect(h.lines[0].data.commands).not.toContainEqual(
    expect.stringMatching(/^(template|blueprint official)\b/),
  );
  const doctor = run(["doctor", "--json"]);
  expect(doctor.code).toBe(0);
  expect(doctor.lines[0].data.nativeStore).toBe(packageInfo.version);
  expect(doctor.lines[0].data.modelApiCalled).toBe(false);
});
it("creates a named blank project, keeps it empty, and refuses to clobber the same target", async () => {
  const created = run([
    "project",
    "create",
    "--name",
    "空白 CLI 项目",
    "--output",
    blankFile,
    "--json",
  ]);
  expect(created.code).toBe(0);
  const bytes = await readFile(blankFile);
  expect(bytes.subarray(0, 2).toString()).toBe("PK");
  expect(created.lines[0].artifacts[0].sha256).toBe(hash(bytes));
  const inspected = run(["project", "inspect", blankFile, "--json"]);
  expect(inspected.code).toBe(0);
  expect(inspected.lines[0].data.displayName).toBe("空白 CLI 项目");
  expect(inspected.lines[0].data.modules).toMatchObject([
    { moduleId: "main", displayName: "主画布" },
  ]);
  expect(inspected.lines[0].data.resources).toEqual([]);
  expect(
    (await readProject(blankFile)).workspaces.main.blocks.blocks,
  ).toEqual([]);
  expect(run(["project", "compile", blankFile, "--json"]).code).toBe(0);
  const conflict = run([
    "project",
    "create",
    "--name",
    "覆盖测试",
    "--output",
    blankFile,
    "--json",
  ]);
  expect(conflict.code).toBe(5);
  expect(hash(await readFile(blankFile))).toBe(hash(bytes));
  expect(conflict.lines[0].error.code).toBe("BLK-CONFLICT-001");
});
it("rejects removed template and official-blueprint CLI entry points", () => {
  const legacyProject = join(directory, "legacy-template.blocky");
  const legacyBlueprint = join(directory, "legacy-official.json");
  for (const args of [
    ["template", "list", "--json"],
    ["template", "show", "research-companion", "--json"],
    ["blueprint", "official", "research-companion", "--output", legacyBlueprint, "--json"],
    ["project", "create", "--template", "research-companion", "--output", legacyProject, "--json"],
  ]) {
    expect(run(args).code).not.toBe(0);
  }
});
it("compiles with the exact desktop compiler and does not rewrite project bytes", async () => {
  const before = hash(await readFile(file));
  const direct = await compileProject(await readProject(file));
  const compiled = run(["project", "compile", file, "--json"]);
  expect(compiled.code).toBe(0);
  expect(compiled.lines[0].data.digest).toBe(await digest(direct.ir));
  expect(compiled.lines[0].data.interaction).toEqual(direct.interaction);
  expect(compiled.lines[0].data.tools).toEqual(direct.tools);
  expect(compiled.lines[0].warnings).toEqual([]);
  expect(hash(await readFile(file))).toBe(before);
  expect(run(["project", "validate", file, "--json"]).code).toBe(0);
  expect(
    run(["project", "module", "list", file, "--json"]).lines[0].data.modules,
  ).toHaveLength(2);
  expect(
    run(["surface", "list", file, "--json"]).lines[0].data.surfaces,
  ).toEqual([]);
});
it("requires explicit simulation and streams actual runtime events plus ingested source evidence", async () => {
  const source = join(directory, "leaves.txt");
  await writeFile(
    source,
    "树叶变黄是因为叶绿素减少。\n\n水循环包括蒸发、凝结和降水。",
    "utf8",
  );
  expect(
    run([
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
    ]).code,
  ).toBe(0);
  expect(
    run([
      "knowledge",
      "sync",
      file,
      "--collection",
      "product-handbook",
      "--json",
    ]).code,
  ).toBe(0);
  expect(run(["run", "start", file, "--input", "树叶", "--jsonl"]).code).toBe(
    2,
  );
  expect(run(["run", "start", file, "--live", "--jsonl"]).code).toBe(2);
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
  expect(answer.citations[0].locator.path).toBe("leaves.txt");
  expect(answer.citations[0].revision).toMatch(/^[a-f0-9]{64}$/);
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
it("configures a declared field through the shared editor and keeps the source archive unchanged", async () => {
  const before = hash(await readFile(file));
  const target = join(directory, "configured.blocky");
  const args = [
    "project",
    "configure",
    file,
    "--module",
    "research-agent",
    "--block",
    "research-root",
    "--field",
    "ROLE",
    "--value",
    "科学教师",
    "--output",
    target,
    "--json",
  ];
  const configured = run(args);
  expect(configured.code).toBe(0);
  expect(configured.lines[0].data.changed).toBe(true);
  expect(configured.lines[0].data.diagnostics).toEqual([]);
  expect(hash(await readFile(file))).toBe(before);
  expect(
    (await readProject(target)).workspaces["research-agent"].blocks.blocks[0]
      .fields!.ROLE,
  ).toBe("科学教师");
  const executed = run([
    "run",
    "start",
    target,
    "--simulate",
    "--input",
    "水循环",
    "--jsonl",
  ]);
  expect(executed.code).toBe(0);
  expect(executed.lines.at(-1).data.answer).toContain("相关资料摘录");
  const saved = hash(await readFile(target));
  expect(run(args).code).toBe(5);
  expect(hash(await readFile(target))).toBe(saved);
  const invalid = [...args];
  invalid[invalid.indexOf("ROLE")] = "API_KEY";
  invalid[invalid.indexOf(target)] = join(directory, "invalid-field.blocky");
  expect(run(invalid).code).toBe(3);
});
it("saves and inserts personal blueprints with explicit bindings and no source overwrite", async () => {
  const before = hash(await readFile(file));
  const blueprint = join(directory, "personal-blueprint.json");
  const capture = [
    "blueprint",
    "create",
    file,
    "--module",
    "research-agent",
    "--blocks",
    "research-root",
    "--name",
    "我的问答",
    "--output",
    blueprint,
    "--json",
  ];
  expect(run(capture).code).toBe(0);
  const shown = run(["blueprint", "show", blueprint, "--json"]);
  expect(shown.code).toBe(0);
  expect(
    shown.lines[0].data.blueprint.resources.filter(
      (r: { kind: string }) => r.kind === "knowledge",
    ),
  ).toHaveLength(1);
  const target = join(directory, "blueprint-inserted.blocky");
  const insert = [
    "blueprint",
    "insert",
    file,
    "--blueprint",
    blueprint,
    "--module",
    "research-agent",
    "--output",
    target,
    "--json",
  ];
  expect(run(insert).code).toBe(3);
  expect(run([...insert, "--reuse-bindings"]).code).toBe(0);
  expect(
    (await readProject(target)).workspaces["research-agent"].blocks.blocks,
  ).toHaveLength(2);
  expect(run(capture).code).toBe(5);
  expect(run([...insert, "--reuse-bindings"]).code).toBe(5);
  expect(hash(await readFile(file))).toBe(before);
});
it("reviews a locked source candidate, applies it only on its base and preserves the original", async () => {
  const before = hash(await readFile(file));
  const candidate = join(directory, "source-candidate.json");
  const scan = run([
    "conversion",
    "scan",
    file,
    "--fixture",
    "haystack-bm25",
    "--module",
    "research-agent",
    "--resource",
    "product-handbook",
    "--output",
    candidate,
    "--json",
  ]);
  expect(scan.code).toBe(0);
  expect(scan.lines[0].data.source.commit).toBe(
    "d72ed6cb37abebaefda8da39e3e7a5d8fffb2065",
  );
  expect(scan.lines[0].data.retained.length).toBeGreaterThan(0);
  expect(
    run(["patch", "preview", file, "--patch", candidate, "--json"]).code,
  ).toBe(0);
  expect(hash(await readFile(file))).toBe(before);
  const target = join(directory, "candidate-applied.blocky");
  expect(
    run([
      "patch",
      "apply",
      file,
      "--patch",
      candidate,
      "--output",
      target,
      "--json",
    ]).code,
  ).toBe(0);
  expect(run(["project", "validate", target, "--json"]).code).toBe(0);
  expect(
    run(["patch", "preview", target, "--patch", candidate, "--json"]).code,
  ).toBe(5);
  expect(hash(await readFile(file))).toBe(before);
});
it("routes duplicate module-local entry IDs by --module and rejects ambiguous requests", async () => {
  const p = createStarter();
  p.manifest.modules.push({
    ...p.manifest.modules[0],
    moduleId: "teacher-agent",
    workspaceRef: "modules/teacher-agent/workspace.json",
  });
  p.workspaces["teacher-agent"] = structuredClone(
    p.workspaces["research-agent"],
  );
  p.workspaces["teacher-agent"].blocks.blocks[0].fields!.ROLE = "科学教师";
  const target = join(directory, "scoped-entries.blocky");
  await createProject(target, p);
  const args = [
    "run",
    "start",
    target,
    "--entry",
    "on-question",
    "--simulate",
    "--input",
    "水循环",
    "--jsonl",
  ];
  expect(run(args).code).toBe(3);
  const result = run([...args, "--module", "teacher-agent"]);
  expect(result.code).toBe(0);
  expect(result.lines.at(-1).data.answer).toContain("学习要点");
  expect(result.lines.some((e) => e.moduleId === "research-agent")).toBe(false);
  expect(
    result.lines.some(
      (e) => e.moduleId === "teacher-agent" && e.type === "block.started",
    ),
  ).toBe(true);
});
it("routes --entry to exactly one adjacent interaction stack", async () => {
  const p = createStarter();
  const root = p.workspaces["research-agent"].blocks.blocks[0];
  let last = root.inputs!.BODY.block!;
  while (last.next) last = last.next.block;
  last.next = {
    block: {
      type: "core.interaction.chat",
      id: "second-question",
      fields: { NAME: "Second" },
      next: {
        block: {
          type: "core.output.answer",
          id: "second-answer",
          fields: { STYLE: "段落" },
        },
      },
    },
  };
  const target = join(directory, "two-entries.blocky");
  await createProject(target, p);
  const result = run([
    "run",
    "start",
    target,
    "--entry",
    "second-question",
    "--simulate",
    "--input",
    "水循环",
    "--jsonl",
  ]);
  expect(result.code).toBe(0);
  const blocks = result.lines
    .filter((e) => e.type === "block.started")
    .map((e) => e.blockId);
  expect(blocks).toEqual(["research-root", "second-question", "second-answer"]);
});
it("native patch checks reject broken exports, schema mismatches, cycles and field enums", async () => {
  const project = createStarter();
  const patch = await makePatch(project, [
    {
      op: "block.update",
      moduleId: "research-agent",
      blockId: "research-root",
      payload: { fields: { ROLE: "教师" } },
    },
  ]);
  const check = (operations: unknown[]) =>
    nativeRequest({
      operation: "validate-patch",
      originalJson: canonicalJson(project),
      patch: { ...patch, operations },
      approved: [],
    });
  expect(
    check([
      {
        op: "block.update",
        moduleId: "research-agent",
        blockId: "call-citation",
        payload: { fields: { EXPORT: "missing" } },
      },
    ]).code,
  ).toBe(3);
  expect(
    check([
      {
        op: "block.update",
        moduleId: "research-agent",
        blockId: "reply-answer",
        payload: { fields: { STYLE: "unknown" } },
      },
    ]).code,
  ).toBe(3);
  expect(
    check([
      {
        op: "block.update",
        moduleId: "research-agent",
        blockId: "call-citation",
        payload: { fields: { INPUT: "schemas/answer.json" } },
      },
    ]).code,
  ).toBe(3);
  expect(
    check([
      {
        op: "block.add",
        moduleId: "research-agent",
        blockId: "orphan-chat",
        payload: {
          type: "core.interaction.chat",
          id: "orphan-chat",
          fields: { NAME: "没有智能体" },
        },
      },
    ]).code,
  ).toBe(3);
  expect(
    check([
      {
        op: "block.add",
        moduleId: "citation-service",
        blockId: "self-call",
        payload: {
          type: "core.module.call",
          id: "self-call",
          fields: {
            MODULE: "citation-service",
            EXPORT: "lookup-v1",
            INPUT: "schemas/query.json",
            OUTPUT: "schemas/citations.json",
          },
        },
      },
    ]).code,
  ).toBe(3);
});
