import { expect, it } from "vitest";
import { ConversionScanner, realConversionCandidate } from "../src";
import { conversionFixture } from "../../../tests/helpers/conversion";
import { createTextProject } from "../../test-fixtures/src/text-project";
import { compileProject } from "../../compiler/src";
import { Runtime } from "../../runtime-core/src";
import { previewPatch, applyPatch } from "../../builder-protocol/src";
import { ProjectController, projectDigest } from "../../project-model/src";
it("converts actual parsed composition, runs multiple inputs, rejects stale patches and undoes atomically", async () => {
  const fixture = await conversionFixture(),
    scanner = new ConversionScanner(fixture.call, "test-project");
  const report = await scanner.analyze(fixture.artifact);
  expect(report.stats).toMatchObject({ analyzed: 2, reused: 0 });
  expect((await scanner.analyze(fixture.artifact)).stats).toMatchObject({
    analyzed: 0,
    reused: 2,
  });
  const project = createTextProject("original"),
    before = await projectDigest(project);
  const candidate = await realConversionCandidate(
    project,
    "main",
    report,
    { file: "math.ts", symbol: "flow", lineStart: 2 },
    scanner,
  );
  expect(candidate.artifactType).toBe("blueprint");
  expect(await projectDigest(project)).toBe(before);
  const preview = await previewPatch(project, candidate.patch);
  expect(preview.diagnostics).toEqual([]);
  const compiled = await compileProject(preview.next);
  const entry = compiled.interaction.entries.find(
    (e) => e.interactionId !== "entry-one",
  )!;
  for (const value of [-3, 0, 1.5, 8]) {
    const result = await new Runtime().run(
      preview.next,
      entry.interactionId,
      JSON.stringify({ x: value }),
      { moduleId: "main" },
    );
    expect(result.status).toBe("completed");
    expect(result.answer).toBe(String(value * 2 + 3));
  }
  const invalid = await new Runtime().run(
    preview.next,
    entry.interactionId,
    '{"x":"unsafe"}',
    { moduleId: "main" },
  );
  expect(invalid.status).not.toBe("completed");
  const controller = new ProjectController(project);
  await applyPatch(controller, candidate.patch, []);
  controller.undo();
  expect(await projectDigest(controller.getSnapshot().project)).toBe(before);
  controller.edit((p) => {
    p.manifest.displayName = "user edit";
  });
  await expect(applyPatch(controller, candidate.patch, [])).rejects.toThrow(
    "BLK-PATCH-001",
  );
});
it("does not trust cached executable programs and rejects tampered source bytes", async () => {
  const fixture = await conversionFixture(),
    scanner = new ConversionScanner(fixture.call, "test-project");
  const report = await scanner.analyze(fixture.artifact);
  const symbol = report.files.find((f) => f.path === "math.ts")!.symbols[1];
  symbol.program!.expression = { number: 999 };
  const candidate = await realConversionCandidate(
    createTextProject(0),
    "main",
    report,
    { file: "math.ts", symbol: "flow", lineStart: 2 },
    scanner,
  );
  expect(JSON.stringify(candidate.patch)).not.toContain('"number":999');
  fixture.page.files[0].content += "tampered";
  await expect(scanner.analyze(fixture.artifact)).rejects.toThrow(
    "BLK-CONVERT-CORRUPT",
  );
});
