import { expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { resolve, join } from "node:path";

it("discovers workflow queries and schemas and reports scoped missing tasks", async () => {
  const dir = await mkdtemp(resolve("try/stage7-workflow-cli-"));
  const call = (args: string[]) => {
    const result = spawnSync(
      process.execPath,
      [resolve("tools/blocky-cli/dist/main.mjs"), ...args],
      {
        encoding: "utf8",
        timeout: 30000,
        windowsHide: true,
        env: { ...process.env, BLOCKY_PROFILE_DIR: join(dir, "profile") },
      },
    );
    return {
      code: result.status,
      value: JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1) ?? "{}"),
    };
  };
  try {
    const list = call([
      "workflow",
      "list",
      "--project-id",
      "project-one",
      "--json",
    ]);
    expect(list.code, JSON.stringify(list.value)).toBe(0);
    expect(list.value.data.tasks).toEqual([]);
    const missing = call([
      "workflow",
      "show",
      "task-missing",
      "--project-id",
      "project-one",
      "--json",
    ]);
    expect(missing.value.error.code).toBe("BLK-WORKFLOW-NOT-FOUND");
    const wrong = call([
      "workflow",
      "show",
      "../other",
      "--project-id",
      "project-one",
      "--json",
    ]);
    expect(wrong.value.error.code).toBe("BLK-WORKFLOW-INVALID");
    const discovery = call([
      "command",
      "list",
      "--query",
      "workflow",
      "--json",
    ]);
    expect(discovery.value.data.commands).toHaveLength(2);
    const schema = call([
      "schema",
      "show",
      "blocky.workflow-summary/v1",
      "--json",
    ]);
    expect(schema.value.data.schema.additionalProperties).toBe(false);
    expect(schema.value.data.schema.properties).not.toHaveProperty("state");
    const guidance = call([
      "diagnostics",
      "explain",
      "BLK-WORKFLOW-UNCERTAIN",
      "--json",
    ]);
    expect(guidance.code).toBe(0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
