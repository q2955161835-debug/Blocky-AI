import {
  canonicalJson,
  type Project,
  type Resource,
} from "@blocky/language-schema";
import { projectDigest, findBlock } from "@blocky/project-model";
import { compileProject, walkNodes } from "@blocky/compiler";
import { resolveResource } from "@blocky/resource-registry";
import { catalogVersion } from "@blocky/block-catalog";
import { parsePatch, type PatchOperation } from "./validate";
import { projectWithOperations } from "./operations";
import { surfaceFromProject } from "@blocky/app-surface";
import { rpaNodePermissions } from "@blocky/rpa-core";
const same = (a: string[], b: string[]) =>
  canonicalJson([...new Set(a)].sort()) ===
  canonicalJson([...new Set(b)].sort());
async function permissions(
  project: Project,
  userRegistry?: Map<string, Resource>,
  allowUnresolved = false,
) {
  const compiled = await compileProject(project, userRegistry),
    values = new Set(compiled.tools.flatMap((t) => t.permissions));
  for (const surface of project.manifest.appSurfaces)
    surfaceFromProject(project, surface.surfaceId).manifest.permissions.forEach(
      (p) => values.add(p),
    );
  for (const module of compiled.modules)
    for (const { node } of walkNodes(module.roots)) {
      rpaNodePermissions(node.blockType, node.fields).forEach(permission => values.add(permission));
      if (node.blockType === "core.model.compose") {
        // A broken old reference cannot grant capabilities. The resulting
        // project is still compiled and resolved strictly before acceptance.
        if (
          allowUnresolved &&
          !project.manifest.resources.some(
            (r) =>
              r.resourceId === String(node.fields.RESOURCE) &&
              r.kind === "model",
          )
        )
          continue;
        const resource = resolveResource(
          project,
          String(node.fields.RESOURCE),
          "model",
          userRegistry,
        );
        resource.capabilityRequirements.forEach((p) => values.add(p));
      }
    }
  return { compiled, values };
}
export async function previewPatch(
  project: Project,
  input: unknown,
  userRegistry?: Map<string, Resource>,
) {
  const patch = parsePatch(input);
  if (
    patch.projectId !== project.manifest.projectId ||
    patch.baseDigest !== (await projectDigest(project))
  )
    throw Error("BLK-PATCH-001");
  if (patch.catalogVersion !== catalogVersion) throw Error("BLK-PATCH-002");
  const next = projectWithOperations(project, patch.operations);
  const [before, after] = await Promise.all([
    permissions(project, userRegistry, true),
    permissions(next, userRegistry),
  ]);
  if (after.compiled.diagnostics.some((d) => d.severity === "error"))
    throw Error("BLK-PATCH-004");
  const permissionDelta = [...after.values]
    .filter((p) => !before.values.has(p))
    .sort();
  if (!same(permissionDelta, patch.permissionDelta))
    throw Error("BLK-PATCH-003");
  return {
    patch,
    next,
    permissionDelta,
    diagnostics: after.compiled.diagnostics,
    changes: patch.operations.map((o) =>
      o.op === "app-surface.add"
        ? {
            operation: o.op,
            moduleId: o.manifest.associatedModuleIds[0],
            blockId: o.manifest.surfaceId,
            before: null,
            after: null,
            payload: null,
            surface: { manifest: o.manifest, files: o.files },
          }
        : {
            operation: o.op,
            moduleId: o.moduleId,
            blockId: o.blockId,
            before:
              findBlock(
                project.workspaces[o.moduleId]?.blocks.blocks ?? [],
                o.blockId,
              ) ?? null,
            after:
              findBlock(
                next.workspaces[o.moduleId]?.blocks.blocks ?? [],
                o.blockId,
              ) ?? null,
            payload: "payload" in o ? o.payload : null,
          },
    ),
  };
}
export async function makePatch(
  project: Project,
  operations: PatchOperation[],
  userRegistry?: Map<string, Resource>,
) {
  const next = projectWithOperations(project, operations);
  const [before, after] = await Promise.all([
    permissions(project, userRegistry, true),
    permissions(next, userRegistry),
  ]);
  const patch = {
    schemaVersion: "blocky.patch/v1alpha1" as const,
    patchId: `patch-${crypto.randomUUID()}`,
    projectId: project.manifest.projectId,
    baseDigest: await projectDigest(project),
    catalogVersion,
    operations,
    permissionDelta: [...after.values]
      .filter((p) => !before.values.has(p))
      .sort(),
    diagnostics: after.compiled.diagnostics,
  };
  return parsePatch(patch);
}
