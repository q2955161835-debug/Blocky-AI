import { afterAll, beforeAll, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";

const root = resolve("try/agent-capability-upgrade/model-cli-tests");
let directory: string;
beforeAll(async () => {
  await mkdir(root, { recursive: true });
  directory = await mkdtemp(join(root, "native-"));
});
afterAll(async () => {
  if (directory && directory.startsWith(root + sep))
    await rm(directory, { recursive: true, force: true });
});
function run(...args: string[]) {
  const result = spawnSync(
    process.execPath,
    [resolve("tools/blocky-cli/dist/main.mjs"), ...args, "--json"],
    {
      encoding: "utf8",
      windowsHide: true,
      timeout: 20000,
      env: { ...process.env, BLOCKY_PROFILE_DIR: join(directory, "profile") },
    },
  );
  expect(result.error).toBeUndefined();
  return { status: result.status, value: JSON.parse(result.stdout) };
}
it("discovers native model artifacts and the v2 request/response schemas", () => {
  const result = run("model", "catalog");
  expect(result.status).toBe(0);
  expect(result.value.data.models[0]).toMatchObject({
    modelId: "qwen3-0.6b-q8-v1",
    externalApi: false,
  });
  for (const id of ["blocky.model-request/v2", "blocky.model-response/v2"]) {
    const schema = run("schema", "show", id);
    expect(schema.status).toBe(0);
    expect(schema.value.data.schemaId).toBe(id);
  }
});
it("returns a clear missing-model result without downloading or touching another profile", () => {
  const status = run("model", "status", "qwen3-0.6b-q8-v1");
  expect(status.status).toBe(0);
  expect(status.value.data.installed).toBe(false);
  const verify = run("model", "verify", "qwen3-0.6b-q8-v1");
  expect(verify.status).toBe(3);
  expect(verify.value.error).toMatchObject({ code: "BLK-LOCAL-MODEL-MISSING" });
  expect(verify.value.error.hint).toContain("model install");
});
it("rejects a missing resource in a valid preflight request without external model calls", async () => {
  const file = join(directory, "public-request.json");
  await writeFile(
    file,
    JSON.stringify({
      schemaVersion: "blocky.model-request/v2",
      projectId: "public-project",
      requestId: "public-request",
      resourceId: "missing-model",
      messages: [{ role: "user", content: "Public synthetic input" }],
      maxOutputTokens: 64,
      timeoutMs: 1000,
    }),
  );
  const result = run("model", "preflight", "--request", file);
  expect(result.status).toBe(3);
  expect(result.value.error.code).toBe("BLK-MODEL-CONFIG");
});
