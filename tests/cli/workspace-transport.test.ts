import { afterEach, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { WorkspaceTransport } from "../../tools/blocky-cli/src/workspace-transport";

let root: string | undefined;
let transport: WorkspaceTransport | undefined;
afterEach(async () => {
  await transport?.close();
  transport = undefined;
  if (root) await rm(root, { recursive: true, force: true });
  root = undefined;
});

async function setup() {
  await import("node:fs/promises").then(({ mkdir }) => mkdir("try", { recursive: true }));
  root = await mkdtemp(resolve("try/cli-workspace-transport-"));
  const worker = join(root, "worker.mjs");
  const starts = join(root, "starts.log");
  const active = join(root, "active.marker");
  await writeFile(worker, `
import { appendFileSync, writeFileSync, unlinkSync } from "node:fs";
import { createInterface } from "node:readline";
const [starts, active] = process.argv.slice(2);
appendFileSync(starts, "start\\n");
const input = createInterface({ input: process.stdin });
let waiting;
const reply = (value, ok = true, code) => process.stdout.write(JSON.stringify({ schemaVersion: "blocky.project-io/v1alpha1", ok, value, ...(code ? { code } : {}) }) + "\\n");
input.on("line", (line) => {
  const frame = JSON.parse(line);
  if (frame.operation === "workspace-bind") reply({ bound: true });
  else if (frame.operation === "workspace-status") reply({ available: true, sessionId: process.pid, projectId: frame.projectId });
  else if (frame.operation === "workspace-call" && frame.request.operation === "hold") {
    waiting = frame.request.requestId;
    writeFileSync(active, waiting);
  } else if (frame.operation === "workspace-cancel" && frame.requestId === waiting) {
    try { unlinkSync(active); } catch {}
    reply(undefined, false, "BLK-RUN-005");
    waiting = undefined;
  } else if (frame.operation === "workspace-call") reply({ echoed: frame.request.requestId });
});
input.on("close", () => process.exit(0));
`);
  transport = new WorkspaceTransport(process.execPath, [worker, starts, active]);
  return { starts, active };
}

async function waitForFile(path: string) {
  for (let i = 0; i < 200; i++) {
    try {
      return await readFile(path, "utf8");
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  throw new Error(`Timed out waiting for ${path}`);
}

it("uses one actual stdio child across binding, status, cancellation and the next request", async () => {
  const { starts, active } = await setup();
  await transport!.bind("project-a", root!);
  const status = (await transport!.status("project-a")) as { available: boolean; sessionId: number };
  expect(status.available).toBe(true);
  expect(status.sessionId).toBeGreaterThan(0);

  const abort = new AbortController();
  const pending = transport!.call({ requestId: "cancel-me", operation: "hold" }, abort.signal);
  expect(await waitForFile(active)).toBe("cancel-me");
  abort.abort();
  await expect(pending).rejects.toMatchObject({ code: "BLK-RUN-005" });
  await expect(transport!.call({ requestId: "after-cancel", operation: "echo" })).resolves.toEqual({ echoed: "after-cancel" });
  expect((await readFile(starts, "utf8")).trim().split("\n")).toHaveLength(1);
});

it("settles active and queued requests on close without starting another child", async () => {
  const { starts, active } = await setup();
  const pending = transport!.call({ requestId: "hold-open", operation: "hold" });
  expect(await waitForFile(active)).toBe("hold-open");
  const queued = transport!.status("project-a");

  await transport!.close();
  await expect(pending).rejects.toMatchObject({ code: "BLK-CODING-STATE" });
  await expect(queued).rejects.toMatchObject({ code: "BLK-CODING-STATE" });
  expect((await readFile(starts, "utf8")).trim().split("\n")).toHaveLength(1);
});
