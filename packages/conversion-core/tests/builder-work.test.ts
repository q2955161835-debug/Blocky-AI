import { expect, it, vi } from "vitest";
import { runBuilderWork, ConversionScanner } from "../src";
import { conversionFixture } from "../../../tests/helpers/conversion";
import { createTextProject } from "../../test-fixtures/src/text-project";
const signal = new AbortController().signal;
it("executes locked source conversion and reverse preservation through the official work IDs", async () => {
  const fixture = await conversionFixture(),
    scanner = new ConversionScanner(fixture.call, "test-project"),
    p = createTextProject(0);
  const input = {
    schemaVersion: "blocky.work-input/v1",
    moduleId: "main",
    artifact: fixture.artifact,
    selection: { file: "math.ts", symbol: "flow", lineStart: 2 },
  };
  const candidate: any = await runBuilderWork(
    p,
    "convert-github-project-to-blocky",
    input,
    { signal, scanner },
  );
  expect(candidate.patch.operations.length).toBeGreaterThan(0);
  const report: any = await runBuilderWork(
    p,
    "reverse-agent-to-blocky",
    { ...input, selection: undefined },
    { signal, scanner },
  );
  expect(report.completeCompatibility).toBe(false);
  expect(report.convertible.length).toBeGreaterThan(0);
  expect(report.applied).toBe(false);
  await expect(
    runBuilderWork(
      p,
      "convert-github-project-to-blocky",
      {
        ...input,
        selection: { file: "math.ts", symbol: "missing", lineStart: 999 },
      },
      { signal, scanner },
    ),
  ).rejects.toThrow("BLK-CONVERT-004");
  await expect(
    runBuilderWork(
      p,
      "reverse-agent-to-blocky",
      { ...input, artifact: { ...fixture.artifact, commit: "bad" } },
      { signal, scanner },
    ),
  ).rejects.toThrow("BLK-WORK-001");
});
it("routes builds without silent execution and rejects unknown blocks, missing source and permission ports", async () => {
  const p = createTextProject(0),
    build = vi.fn(async () => ({ candidate: true })),
    request = {
      schemaVersion: "blocky.builder-request/v1",
      requestId: "work-test",
      projectId: p.manifest.projectId,
      moduleId: "main",
      intent: "build",
      prompt: "修改",
      selection: [],
      createSurface: false,
    };
  expect(
    await runBuilderWork(p, "build-blocky-agents", request, { signal, build }),
  ).toEqual({ candidate: true });
  expect(build).toHaveBeenCalledTimes(1);
  await expect(
    runBuilderWork(p, "build-blocky-agents", request, { signal }),
  ).rejects.toThrow("BLK-WORK-002");
  await expect(
    runBuilderWork(
      p,
      "create-blocky-blocks",
      {
        schemaVersion: "blocky.work-input/v1",
        request,
        operations: [
          {
            op: "block.add",
            moduleId: "main",
            blockId: "unknown",
            payload: { id: "unknown", type: "shell.run" },
          },
        ],
      },
      { signal },
    ),
  ).rejects.toThrow();
  await expect(
    runBuilderWork(p, "reverse-agent-to-blocky", {}, { signal }),
  ).rejects.toThrow("BLK-WORK-001");
  expect(p.manifest.appSurfaces).toEqual([]);
});
