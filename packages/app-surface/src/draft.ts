import { compileProject } from "@blocky/compiler";
import type { Project, Json, Resource } from "@blocky/language-schema";
import { sourceFiles, validateSurface, type SurfaceDraft } from "./manifest";
export async function draftSurface(
  project: Project,
  moduleId: string,
  intent: "explicit-user-command" | "agent-request",
  userRegistry?: Map<string, Resource>,
): Promise<SurfaceDraft> {
  if (intent !== "explicit-user-command") throw Error("BLK-SURFACE-001");
  if (project.manifest.appSurfaces.length) throw Error("BLK-SURFACE-002");
  const compiled = await compileProject(project, userRegistry),
    entries = compiled.interaction.entries.filter(
      (e) => e.moduleId === moduleId,
    );
  const module = project.manifest.modules.find((m) => m.moduleId === moduleId),
    exports = module?.exports.filter((e) => e.kind === "agent");
  if (
    compiled.diagnostics.some((d) => d.severity === "error") ||
    entries.length !== 1 ||
    exports?.length !== 1
  )
    throw Error("BLK-SURFACE-002");
  const surfaceId = `surface-${crypto.randomUUID()}`,
    base = `surfaces/${surfaceId}`,
    target = exports[0];
  const manifest = {
    schemaVersion: "blocky.app-surface/v1alpha1" as const,
    surfaceId,
    displayName: "资料问答",
    sourceRootRef: `${base}/src`,
    associatedModuleIds: [moduleId],
    bridgeRef: `${base}/bridge.json`,
    permissions: ["surface.preview", "surface.invoke.ask"],
    build: {
      packageManager: "pnpm" as const,
      lockfileRef: `${base}/pnpm-lock.yaml`,
      outputRef: `${base}/dist`,
    },
  };
  const bridge = {
    schemaVersion: "blocky.frontend-bridge/v1alpha1",
    surfaceId,
    endpoints: [
      {
        endpointId: "ask",
        direction: "invoke",
        target: { moduleId, exportId: target.exportId },
        ...(target.inputSchemaRef
          ? { inputSchemaRef: target.inputSchemaRef }
          : {}),
        ...(target.outputSchemaRef
          ? { outputSchemaRef: target.outputSchemaRef }
          : {}),
        approval: "never",
      },
    ],
  };
  const files: Record<string, Json> = {
    ...sourceFiles(surfaceId),
    [`${base}/manifest.json`]: manifest,
    [manifest.bridgeRef]: bridge,
  };
  return validateSurface(project, { manifest, files });
}
