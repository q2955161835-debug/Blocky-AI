import { expect, it } from "vitest";
import { mkdtemp, readFile, writeFile, readdir, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import { spawnSync, spawn } from "node:child_process";
import { atomicOutput } from "../../tools/blocky-cli/src/atomic-output";
import { output } from "../../tools/blocky-cli/src/output";
import { createAgentExample } from "../../packages/block-catalog/src/index";
import {
  createProject,
  readProject,
  applyProjectPatch,
} from "../../tools/blocky-cli/src/native-store";
import { makePatch } from "../../packages/builder-protocol/src/index";
const cli = resolve("tools/blocky-cli/dist/main.mjs");
it("native patch validation accepts current Agent catalog and agrees on tool permissions", async () => {
  const root = await mkdtemp(resolve("try/stage4-patch-"));
  try {
    const p = createAgentExample("stage4-native-patch");
    const original = join(root, "input.blocky"),
      target = join(root, "output.blocky");
    await createProject(original, p);
    const patch = await makePatch(p, [
      {
        op: "block.update",
        moduleId: "research-agent",
        blockId: "instruction",
        payload: { fields: { TEXT: "Explain text counts." } },
      },
    ]);
    expect(patch.permissionDelta).toEqual([]);
    await applyProjectPatch(original, target, p, patch, []);
    expect(
      (await readProject(target)).manifest.format.minimumReaderVersion,
    ).toBe("0.4.0");
    const invalid = structuredClone(p);
    invalid.resources["text-tool"].definition.permissions = [
      "text.analyze",
      "process.exec",
    ];
    await createProject(join(root, "invalid.blocky"), invalid);
    const update = await makePatch(invalid, [
      {
        op: "block.update",
        moduleId: "research-agent",
        blockId: "instruction",
        payload: { fields: { TEXT: "No permission bypass." } },
      },
    ]);
    await applyProjectPatch(
      join(root, "invalid.blocky"),
      join(root, "invalid-patched.blocky"),
      invalid,
      update,
      [],
    );
    // Saving a declaration is not an execution grant; unsupported capabilities fail at run time.
    const refused = run([
      "run",
      "start",
      join(root, "invalid-patched.blocky"),
      "--simulate",
      "--input",
      "public test",
      "--jsonl",
    ]);
    expect(refused.code).toBe(3);
    expect(refused.lines.at(-1).data.pendingApprovals).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
function run(args: string[], profileDir?: string) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 30000,
    ...(profileDir
      ? { env: { ...process.env, BLOCKY_PROFILE_DIR: profileDir } }
      : {}),
  });
  return {
    code: result.status,
    lines: result.stdout
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l)),
  };
}
it("publishes complete file bytes atomically without overwriting or leaving temporary files", async () => {
  const root = await mkdtemp(resolve("try/stage4-output-"));
  try {
    const target = join(root, "result.json");
    await atomicOutput(target, '{"value":42}', new AbortController().signal);
    await expect(
      atomicOutput(target, "wrong", new AbortController().signal),
    ).rejects.toThrow();
    expect(await readFile(target, "utf8")).toBe('{"value":42}');
    const cancel = new AbortController();
    cancel.abort();
    await expect(
      atomicOutput(join(root, "cancelled"), "bad", cancel.signal),
    ).rejects.toThrow();
    expect(await readdir(root)).toEqual(["result.json"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it("preserves numeric usage evidence while redacting secret-shaped values", () => {
  const value = JSON.parse(
    output({
      inputTokens: 3,
      outputTokens: 2,
      totalTokens: 5,
      maxOutputTokens: 1024,
      localRuntime: { contextTokens: 8192, threads: 4 },
      apiKey: "fixture-private",
      accessToken: "fixture-private",
      inputTokensBad: "fixture-private",
    }),
  );
  expect(value.inputTokens).toBe(3);
  expect(value.totalTokens).toBe(5);
  expect(value.localRuntime).toEqual({ contextTokens: 8192, threads: 4 });
  expect(JSON.stringify(value)).not.toContain("fixture-private");
});
it("complete example requires exact approval and produces checked JSON through native tool", async () => {
  const root = await mkdtemp(resolve("try/stage4-cli-"));
  const profile = join(root, "profile");
  try {
    const file = join(root, "agent.blocky");
    expect(
      run(
        [
          "project",
          "create",
          "--template",
          "agent-loop",
          "--output",
          file,
          "--json",
        ],
        profile,
      ).code,
    ).toBe(0);
    const base = [
      "run",
      "start",
      file,
      "--simulate",
      "--input",
      "Hello Blocky",
      "--run-id",
      `run-${crypto.randomUUID()}`,
      "--jsonl",
    ];
    const pending = run(base, profile);
    expect(pending.code).toBe(4);
    const approval = pending.lines.at(-1).data.pendingApprovals[0];
    expect(approval.kind).toBe("tool");
    const approved = join(root, "approve.json");
    await writeFile(approved, JSON.stringify([approval.requestDigest]));
    const exported = join(root, "result.json");
    const done = run(
      [...base, "--approval-file", approved, "--output", exported],
      profile,
    );
    expect(
      done.code,
      JSON.stringify(
        done.lines.filter((line) => JSON.stringify(line).includes("BLK-")),
      ),
    ).toBe(0);
    expect(done.lines.at(-1).data.structured).toEqual({
      characters: 12,
      lines: 1,
      words: 2,
    });
    expect(JSON.parse(await readFile(exported, "utf8")).words).toBe(2);
    expect(done.lines.at(-1).data.modelApiCalled).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
