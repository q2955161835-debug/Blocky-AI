import { expect, it } from "vitest";
import fixture from "./fixtures/generated-surface.json";
import {
  validateSurface,
  generatedSourceFiles,
} from "../../packages/app-surface/src";
it("keeps generated frontend source identical across the Host contract fixture", () => {
  const project = fixture.project as any,
    draft = validateSurface(project, fixture.draft);
  const base = `surfaces/${draft.manifest.surfaceId}`;
  const files = generatedSourceFiles(
    draft.manifest.surfaceId,
    draft.files[`${base}/surface-spec.json`],
  );
  for (const [path, value] of Object.entries(files))
    expect(draft.files[path]).toEqual(value);
});
