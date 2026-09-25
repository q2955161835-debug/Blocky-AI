import { z } from "zod";
import {
  stableId,
  validRef,
  canonicalJson,
  type Project,
  type Json,
} from "@blocky/language-schema";
import sources from "./sources.json";
import { generatedSourceFiles } from "./generated";
const id = z.string().regex(stableId).max(200),
  ref = z.string().refine(validRef);
export const surfaceManifest = z
  .object({
    schemaVersion: z.enum([
      "blocky.app-surface/v1alpha1",
      "blocky.app-surface/v1",
    ]),
    surfaceId: id,
    displayName: z.string().min(1).max(100),
    sourceRootRef: ref,
    associatedModuleIds: z.array(id).length(1),
    bridgeRef: ref,
    permissions: z.array(z.string()).length(2),
    build: z
      .object({
        packageManager: z.literal("pnpm"),
        lockfileRef: ref,
        outputRef: ref,
      })
      .strict(),
  })
  .strict();
const bridge = z
  .object({
    schemaVersion: z.literal("blocky.frontend-bridge/v1alpha1"),
    surfaceId: id,
    endpoints: z
      .array(
        z
          .object({
            endpointId: z.literal("ask"),
            direction: z.literal("invoke"),
            target: z.object({ moduleId: id, exportId: id }).strict(),
            inputSchemaRef: ref.optional(),
            outputSchemaRef: ref.optional(),
            approval: z.literal("never"),
          })
          .strict(),
      )
      .length(1),
  })
  .strict();
export const draftSchema = z
  .object({ manifest: surfaceManifest, files: z.record(ref, z.json()) })
  .strict();
export type SurfaceDraft = z.infer<typeof draftSchema>;
export function sourceFiles(surfaceId: string): Record<string, Json> {
  return Object.fromEntries(
    Object.entries(sources.files).map(([path, content]) => [
      `surfaces/${surfaceId}/${path}`,
      path.endsWith(".json") ? JSON.parse(content) : content,
    ]),
  );
}
export function validateSurface(
  project: Project,
  input: unknown,
): SurfaceDraft {
  try {
    if (canonicalJson(input).length > 100000) throw Error();
    const draft = draftSchema.parse(input),
      m = draft.manifest,
      base = `surfaces/${m.surfaceId}`;
    if (
      m.sourceRootRef !== `${base}/src` ||
      m.bridgeRef !== `${base}/bridge.json` ||
      m.build.lockfileRef !== `${base}/pnpm-lock.yaml` ||
      m.build.outputRef !== `${base}/dist` ||
      canonicalJson(m.permissions) !==
        canonicalJson(["surface.preview", "surface.invoke.ask"])
    )
      throw Error();
    const b = bridge.parse(draft.files[m.bridgeRef]),
      endpoint = b.endpoints[0];
    if (
      b.surfaceId !== m.surfaceId ||
      endpoint.target.moduleId !== m.associatedModuleIds[0]
    )
      throw Error();
    const module = project.manifest.modules.find(
      (module) => module.moduleId === endpoint.target.moduleId,
    );
    const target = module?.exports.find(
      (e) => e.exportId === endpoint.target.exportId && e.kind === "agent",
    );
    if (
      !target ||
      target.inputSchemaRef !== endpoint.inputSchemaRef ||
      target.outputSchemaRef !== endpoint.outputSchemaRef
    )
      throw Error();
    const expected = {
      ...(m.schemaVersion === "blocky.app-surface/v1"
        ? generatedSourceFiles(
            m.surfaceId,
            draft.files[`${base}/surface-spec.json`],
          )
        : sourceFiles(m.surfaceId)),
      [`${base}/manifest.json`]: m,
      [m.bridgeRef]: b,
    };
    if (
      m.schemaVersion === "blocky.app-surface/v1" &&
      (draft.files[`${base}/surface-spec.json`] as { title?: string })
        ?.title !== m.displayName
    )
      throw Error();
    if (canonicalJson(draft.files) !== canonicalJson(expected)) throw Error();
    return draft;
  } catch {
    throw Error("BLK-SURFACE-002");
  }
}
export function surfaceFromProject(project: Project, surfaceId: string) {
  const descriptor = project.manifest.appSurfaces.find(
    (s) => s.surfaceId === surfaceId,
  );
  if (!descriptor) throw Error("BLK-SURFACE-002");
  const prefix = `surfaces/${surfaceId}/`;
  return validateSurface(project, {
    manifest: project.surfaces[descriptor.manifestRef],
    files: Object.fromEntries(
      Object.entries(project.surfaces).filter(([path]) =>
        path.startsWith(prefix),
      ),
    ),
  });
}

/** Navigation reads the accepted manifest without rebuilding the page on every render. */
export function surfaceTitle(project: Project, surfaceId: string): string {
  const descriptor = project.manifest.appSurfaces.find(
    (s) => s.surfaceId === surfaceId,
  );
  const parsed = surfaceManifest.safeParse(
    descriptor ? project.surfaces[descriptor.manifestRef] : undefined,
  );
  return parsed.success ? parsed.data.displayName : "应用界面";
}
