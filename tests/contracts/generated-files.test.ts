import { it, expect } from "vitest";
import { mkdtemp, readFile, stat, utimes, rm } from "node:fs/promises";
import { join } from "node:path";
// @ts-expect-error Build scripts run as native JavaScript.
import { writeGenerated } from "../../scripts/write-generated.mjs";

it("keeps an unchanged digest stable and still replaces changed content", async () => {
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
