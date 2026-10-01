import { it, expect } from "vitest";
import { mkdir, mkdtemp, readFile, stat, utimes, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
// @ts-expect-error Build scripts run as native JavaScript.
import { writeGenerated } from "../../scripts/write-generated.mjs";

it("preserves browser lock bytes in a Windows checkout", async () => {
  await mkdir("try", { recursive: true });
  const root = await mkdtemp(join("try", "browser-lock-checkout-"));
  const lock = "packages/rpa-core/runtime-lock.json";
  try {
    execFileSync("git", ["-c", "core.autocrlf=true", "checkout-index",
      `--prefix=${resolve(root).replaceAll("\\", "/")}/`, "--", lock]);
    const committed = execFileSync("git", ["show", `:${lock}`]);
    const checkedOut = await readFile(join(root, lock));
    expect(checkedOut.length).toBe(committed.length);
    expect(checkedOut.equals(committed)).toBe(true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("keeps an unchanged digest stable and still replaces changed content", async () => {
  await mkdir("try", { recursive: true });
  const root = await mkdtemp(join("try", "generated-manifest-"));
  const file = join(root, "digest.json");
  try {
    await writeGenerated(file, '{"digest":"first"}\r\n');
    const earlier = new Date("2020-01-01T00:00:00Z");
    await utimes(file, earlier, earlier);
    await writeGenerated(file, '{"digest":"first"}\n');
    expect((await stat(file)).mtimeMs).toBe(earlier.getTime());
    expect(await readFile(file, "utf8")).toBe('{"digest":"first"}\r\n');
    await writeGenerated(file, '{"digest":"second"}\n');
    expect(await readFile(file, "utf8")).toBe('{"digest":"second"}\n');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
