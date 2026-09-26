import { expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { resolve, join } from "node:path";

it("discovers capture retention and refuses an unscoped image identifier", async () => {
  const dir = await mkdtemp(resolve("try/stage7-capture-cli-"));
  const call = (args: string[]) => {
    const child = spawnSync(process.execPath, [resolve("tools/blocky-cli/dist/main.mjs"), ...args], { encoding: "utf8", timeout: 30000, windowsHide: true, env: { ...process.env, BLOCKY_PROFILE_DIR: join(dir, "profile") } });
    return { code: child.status, data: JSON.parse(child.stdout.trim().split(/\r?\n/).at(-1) ?? "{}") };
  };
  try {
    const list = call(["rpa", "captures", "--json"]);
    expect(list.code, JSON.stringify(list.data)).toBe(0);
    expect(list.data.data.captures).toEqual([]);
    const bad = call(["rpa", "capture-export", "../other", "--output", join(dir, "image.png"), "--json"]);
    expect(bad.data.error.code).toBe("BLK-RPA-CAPTURE-002");
    const discovery = call(["command", "list", "--query", "rpa capture", "--json"]);
    expect(discovery.data.data.commands).toHaveLength(3);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
