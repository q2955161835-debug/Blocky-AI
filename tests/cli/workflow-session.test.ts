import { expect, it } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { mkdtemp, rm } from "node:fs/promises";
import { resolve, join } from "node:path";

it("keeps a crashed native intent uncertain and refuses a competing or replacement session", async () => {
  const directory = await mkdtemp(resolve("try/stage7-workflow-channel-"));
  const executable = resolve("tools/blocky-cli/dist/bin/blocky-project-io.exe");
  const env = {
    ...process.env,
    BLOCKY_PROFILE_DIR: join(directory, "profile"),
  };
  const initial = {
    schemaVersion: "blocky.workflow-session/v1",
    definition: {
      projectId: "project-one",
      moduleId: "main",
      blockId: "flow",
      planDigest: "a".repeat(64),
      runtimeVersion: 1,
      steps: [{ stepId: "effect", kind: "action", compensate: false }],
    },
    initial: { private: "channel-canary" },
  };
  const child = spawn(executable, ["--blocky-workflow-session"], {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
    env,
  });
  child.stderr.resume();
  const lines = createInterface({ input: child.stdout }),
    stream = lines[Symbol.asyncIterator]();
  const exited = once(child, "close");
  const send = (value: unknown) =>
    child.stdin.write(JSON.stringify(value) + "\n");
  const reply = async () => JSON.parse((await stream.next()).value!);
  try {
    send(initial);
    const ready = await reply();
    expect(ready.type).toBe("ready");
    const taskId = ready.value.taskId;
    const conflict = spawnSync(executable, ["--blocky-workflow-session"], {
      input: JSON.stringify({ ...initial, taskId }) + "\n",
      encoding: "utf8",
      timeout: 5000,
      windowsHide: true,
      env,
    });
    expect(JSON.parse(conflict.stdout.trim()).value.code).toBe(
      "BLK-WORKFLOW-OWNER",
    );
    send({
      operation: "commit",
      requestId: 1,
      action: { kind: "begin", revision: 1 },
    });
    expect((await reply()).value.status).toBe("executing");
    child.kill();
    await exited;
    const resumed = spawnSync(executable, ["--blocky-workflow-session"], {
      input: JSON.stringify({ ...initial, taskId }) + "\n",
      encoding: "utf8",
      timeout: 5000,
      windowsHide: true,
      env,
    });
    expect(JSON.parse(resumed.stdout.trim()).value.code).toBe(
      "BLK-WORKFLOW-UNCERTAIN",
    );
    const read = spawnSync(executable, [], {
      input: JSON.stringify({
        schemaVersion: "blocky.project-io/v1alpha1",
        operation: "workflow-show",
        projectId: "project-one",
        taskId,
      }),
      encoding: "utf8",
      timeout: 5000,
      windowsHide: true,
      env,
    });
    const record = JSON.parse(read.stdout).value;
    expect(record.status).toBe("executing");
    expect(record.revision).toBe(2);
    expect(read.stdout).not.toContain("channel-canary");
  } finally {
    child.kill();
    await exited;
    lines.close();
    await rm(directory, { recursive: true, force: true });
  }
});
