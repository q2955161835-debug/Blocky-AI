import type { Project } from "@blocky/language-schema";
import { surfaceFromProject } from "./manifest";
import { previewDocument } from "./preview";
/** Compile accepted source only. No package manager, scripts, network or subprocess. */
export function buildSurface(project: Project, surfaceId: string) {
  const draft = surfaceFromProject(project, surfaceId);
  const html = previewDocument(draft);
  return {
    surfaceId,
    outputRef: `${draft.manifest.build.outputRef}/index.html`,
    html,
    dependencies: [] as string[],
  };
}
