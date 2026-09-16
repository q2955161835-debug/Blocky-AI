import { it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
it("exports only whitelisted diagnostic metadata and refuses overwriting an existing artifact", async () => {
  const dir = await mkdtemp(resolve("try/diagnostics-cli-"));
  try {
    const input = join(dir, "input.json"),
      output = join(dir, "output.json");
    await writeFile(
      input,
      JSON.stringify({
        dropped: 4,
        droppedImportant: 2,
        records: [
          {
            timestamp: "2026-09-16T00:00:00.000Z",
            sequence: 1,
            level: "info",
            channel: "runtime",
            message: "PRIVATE_TEST_BODY",
            attributes: { custom: "PRIVATE_TEST_ATTRIBUTE" },
          },
        ],
      }),
    );
    const args = [
      resolve("tools/blocky-cli/dist/main.mjs"),
      "diagnostics",
      "export",
      input,
      "--output",
      output,
      "--json",
    ];
    const run = () =>
      spawnSync(process.execPath, args, {
        encoding: "utf8",
        windowsHide: true,
        timeout: 20000,
      });
    expect(run().status).toBe(0);
    const text = await readFile(output, "utf8");
    expect(text).not.toContain("PRIVATE_TEST");
    expect(JSON.parse(text).records[0].channel).toBe("runtime");
    expect(JSON.parse(text)).toMatchObject({ dropped: 4, droppedImportant: 2 });
    expect(run().status).toBe(5);
    expect(await readFile(output, "utf8")).toBe(text);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
