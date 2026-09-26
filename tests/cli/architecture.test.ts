import { expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createArchitectureStarter } from "../../packages/block-catalog/src";
import { createProject } from "../../tools/blocky-cli/src/native-store";
import { createParallelProject } from "../../packages/test-fixtures/src/parallel-project";
const cli = resolve("tools/blocky-cli/dist/main.mjs");
function run(args: string[]) {
  const child = spawnSync(process.execPath, [cli, ...args], {
    encoding: "utf8",
    timeout: 30000,
    windowsHide: true,
  });
  return {
    code: child.status,
    result: child.stdout
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .at(-1),
  };
}
it("discovers and runs parallel branches through the shared CLI runtime", async () => {
  const directory = await mkdtemp(resolve("try/stage7-parallel-"));
  try {
    const project = join(directory, "parallel.blocky");
    await createProject(project, createParallelProject());
    expect(run(["catalog", "show", "core.flow.parallel", "--json"]).code).toBe(0);
    const result = run(["run", "start", project, "--simulate", "--input", "start", "--jsonl"]);
    expect(result.code, JSON.stringify(result.result)).toBe(0);
    expect(result.result.data.structured).toEqual(["left", "right"]);
    expect(result.result.data.modelApiCalled).toBe(false);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
it("creates and runs the event mailbox with FIFO results in one CLI session", async () => {
  const directory = await mkdtemp(resolve("try/stage7-mailbox-"));
  try {
    const project = join(directory, "mailbox.blocky"), inputs = join(directory, "inputs.json");
    const created = run(["project", "create", "--template", "event-mailbox", "--output", project, "--json"]);
    expect(created.code, JSON.stringify(created.result)).toBe(0);
    await writeFile(inputs, JSON.stringify(["first", "second", "next", "next", "next"]));
    const result = run(["run", "start", project, "--simulate", "--inputs-file", inputs, "--jsonl"]);
    expect(result.code, JSON.stringify(result.result)).toBe(0);
    expect(result.result.data.runs.map((r: { structured: unknown }) => r.structured)).toEqual(["queued", "queued", "first", "second", "empty"]);
    expect(result.result.data.modelApiCalled).toBe(false);
    expect(run(["catalog", "show", "core.event.receive", "--json"]).code).toBe(0);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
it("discovers architecture projects and executes a stateful input sequence in one CLI session", async () => {
  const directory = await mkdtemp(resolve("try/stage7-architectures-"));
  try {
    const project = join(directory, "state.blocky"),
      inputs = join(directory, "inputs.json");
    await createProject(project, createArchitectureStarter("state-machine"));
    await writeFile(inputs, JSON.stringify(["start", "finish", "start"]));
    const trace = join(directory, "trace.json");
    const result = run([
      "run",
      "start",
      project,
      "--simulate",
      "--inputs-file",
      inputs,
      "--trace-output",
      trace,
      "--jsonl",
    ]);
    expect(result.code, JSON.stringify(result.result)).toBe(0);
    expect(
      result.result.data.runs.map((r: { structured: unknown }) => r.structured),
    ).toEqual(["running", "done", "done"]);
    expect(
      new Set(result.result.data.runs.map((r: { runId: string }) => r.runId))
        .size,
    ).toBe(3);
    expect(result.result.data.modelApiCalled).toBe(false);
    expect(result.result.data.traceScope).toBe("last-run");
    const exported = JSON.parse(await readFile(trace, "utf8"));
    expect(
      new Set(exported.frames.map((e: { runId: string }) => e.runId)),
    ).toEqual(new Set([result.result.data.runId]));
    const schema = run(["schema", "show", "blocky.run-inputs/v1", "--json"]);
    expect(schema.code).toBe(0);
    expect(schema.result.data.schema).toMatchObject({
      type: "array",
      minItems: 1,
      maxItems: 32,
    });
    expect(
      run(["template", "show", "state-machine", "--json"]).result.data.kind,
    ).toBe("project");
    const denied = run([
      "run",
      "start",
      project,
      "--simulate",
      "--input",
      "start",
      "--inputs-file",
      inputs,
      "--jsonl",
    ]);
    expect(denied.code).toBe(2);
    for (const invalid of [
      [],
      Array(33).fill("start"),
      [12],
      ["中".repeat(5334)],
    ]) {
      await writeFile(inputs, JSON.stringify(invalid));
      expect(
        run([
          "run",
          "start",
          project,
          "--simulate",
          "--inputs-file",
          inputs,
          "--jsonl",
        ]).code,
      ).toBe(2);
    }
    await writeFile(inputs, JSON.stringify(["start", "finish"]));
    const actions = join(directory, "actions.json");
    await writeFile(actions, '["stop"]');
    const stopped = run([
      "run",
      "start",
      project,
      "--simulate",
      "--inputs-file",
      inputs,
      "--breakpoint",
      "main:on-event",
      "--debug-actions",
      actions,
      "--jsonl",
    ]);
    expect(stopped.code).toBe(7);
    expect(stopped.result.data.runs).toHaveLength(1);
    expect(stopped.result.data.completedInputs).toBe(0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
