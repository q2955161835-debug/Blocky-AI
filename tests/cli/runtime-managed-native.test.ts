import { expect, it } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  createArchitectureStarter,
  createAgentExample,
} from "../../packages/block-catalog/src";
import { createProject } from "../../tools/blocky-cli/src/native-store";
it.each([true, false])(
  "preserves public CLI interactive tool approval (%s) through native custody",
  async (approve) => {
    const dir = await mkdtemp(resolve("try/stage7-managed-approval-"));
    const file = join(dir, "agent.blocky");
    await createProject(file, createAgentExample("owned-approval"));
    const child = spawn(
      process.execPath,
      [
        resolve("tools/blocky-cli/dist/main.mjs"),
        "run",
        "start",
        file,
        "--simulate",
        "--interactive",
        "--input",
        "Hello Blocky",
        "--jsonl",
      ],
      {
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, BLOCKY_PROFILE_DIR: join(dir, "profile") },
      },
    );
    let buffer = "",
      prompts = 0;
    const rows: any[] = [];
    child.stderr.resume();
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      buffer += chunk;
      let end: number;
      while ((end = buffer.indexOf("\n")) >= 0) {
        const row = JSON.parse(buffer.slice(0, end));
        buffer = buffer.slice(end + 1);
        rows.push(row);
        if (row.command === "run.approval-required") {
          prompts++;
          child.stdin.write(
            (approve ? row.data.requestDigest : "reject") + "\n",
          );
        }
      }
    });
    try {
      const code = await new Promise<number | null>((done, reject) => {
        child.once("error", reject);
        child.once("close", done);
      });
      expect(code, JSON.stringify(rows.at(-1))).toBe(approve ? 0 : 4);
      expect(prompts).toBe(1);
      expect(rows.at(-1).data.modelApiCalled).toBe(false);
      if (approve) expect(rows.at(-1).data.structured.words).toBe(2);
      else expect(rows.at(-1).data.pendingApprovals).toHaveLength(1);
    } finally {
      child.stdin.destroy();
      child.kill();
      await rm(dir, { recursive: true, force: true });
    }
  },
  30000,
);
it("runs the actual Runtime in a native child, strips Node startup injection, and settles cancellation before returning", async () => {
  const dir = await mkdtemp(resolve("try/stage7-managed-native-"));
  const file = join(dir, "owned.blocky"),
    profile = join(dir, "profile");
  const project = createArchitectureStarter("durable-workflow");
  const root = project.workspaces.main.blocks!.blocks[0];
  root.inputs!.HANDLER.block!.inputs!.STEPS.block!.inputs!.DO = {
    block: {
      id: "wait-owned",
      type: "core.event.receive",
      fields: { CHANNEL: "empty", TIMEOUT_MS: "30000" },
      inputs: {
        EMPTY: {
          block: {
            id: "empty-value",
            type: "core.data.set",
            fields: { VALUE: '"empty"' },
          },
        },
      },
    },
  };
  await createProject(file, project);
  const helper = resolve("tools/blocky-cli/dist/bin/blocky-project-io.exe");
  const child = spawn(helper, ["--blocky-runtime-session"], {
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      BLOCKY_PROFILE_DIR: profile,
      NODE_OPTIONS: "--blocky-invalid-preload-option",
    },
  });
  const rows: any[] = [];
  let buffer = "",
    workers: number[] = [];
  let observed = false;
  child.stderr.resume();
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    buffer += chunk;
    let end: number;
    while ((end = buffer.indexOf("\n")) >= 0) {
      const frame = JSON.parse(buffer.slice(0, end));
      buffer = buffer.slice(end + 1);
      rows.push(frame);
      if (
        frame.kind === "output" &&
        frame.value.type === "block.started" &&
        frame.value.blockId === "wait-owned" &&
        !observed
      ) {
        observed = true;
        const query = spawnSync(
          "powershell.exe",
          [
            "-NoProfile",
            "-Command",
            `Get-CimInstance Win32_Process -Filter 'ParentProcessId = ${child.pid}' | Select-Object -ExpandProperty ProcessId`,
          ],
          { windowsHide: true, encoding: "utf8", timeout: 10000 },
        );
        workers = query.stdout.trim().split(/\s+/).filter(Boolean).map(Number);
        child.stdin.write('{"kind":"cancel"}\n');
      }
    }
  });
  try {
    const exited = new Promise<number | null>((done, reject) => {
      child.once("error", reject);
      child.once("close", done);
    });
    child.stdin.write(
      JSON.stringify({
        kind: "start",
        schemaVersion: "blocky.runtime-session/v1",
        argv: [
          "run",
          "start",
          file,
          "--simulate",
          "--input",
          "owned",
          "--jsonl",
        ],
      }) + "\n",
    );
    expect(await exited, JSON.stringify(rows.at(-1))).toBe(0);
    expect(observed).toBe(true);
    expect(workers.length).toBeGreaterThan(0);
    expect(rows.at(-1).kind).toBe("done");
    expect(rows.at(-1).value.code).toBe(7);
    expect(rows.at(-1).value.result.data.modelApiCalled).toBe(false);
    expect(rows.at(-1).value.result.data.workflow.status).toBe("uncertain");
    for (const pid of workers) expect(() => process.kill(pid, 0)).toThrow();
  } finally {
    child.stdin.destroy();
    child.kill();
    await rm(dir, { recursive: true, force: true });
  }
}, 45000);

it.each([undefined, "blocky.runtime-session/v999"])(
  "rejects unknown native Runtime handshake version %s before dispatch",
  (version) => {
    const result = spawnSync(
      resolve("tools/blocky-cli/dist/bin/blocky-project-io.exe"),
      ["--blocky-runtime-session"],
      {
        windowsHide: true,
        encoding: "utf8",
        timeout: 10000,
        input:
          JSON.stringify({
            kind: "start",
            ...(version ? { schemaVersion: version } : {}),
            argv: ["run", "start"],
          }) + "\n",
      },
    );
    expect(result.status).toBe(3);
    expect(JSON.parse(result.stdout)).toEqual({
      kind: "error",
      code: "BLK-WORKFLOW-INVALID",
    });
  },
);
