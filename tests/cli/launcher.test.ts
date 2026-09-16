import { it, expect } from "vitest";
import { spawnSync } from "node:child_process";
it("preserves the CLI argument error code through the Windows command launcher", () => {
  const result = spawnSync(
    "cmd.exe",
    ["/d", "/c", "blocky.cmd project create --output"],
    { encoding: "utf8", windowsHide: true, timeout: 10000 },
  );
  expect(result.status).toBe(2);
  expect(JSON.parse(result.stdout)).toMatchObject({
    ok: false,
    error: { code: "BLK-CLI-002" },
    artifacts: [],
  });
});
