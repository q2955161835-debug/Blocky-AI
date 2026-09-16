import {
  canonicalJson,
  type Project,
  type Resource,
} from "@blocky/language-schema";
import { ProjectController } from "@blocky/project-model";
import { previewPatch } from "./preview";
export async function applyPatch(
  controller: ProjectController,
  input: unknown,
  approvedCapabilities: string[],
  hostValidate?: (
    original: Project,
    patch: unknown,
    approved: string[],
  ) => Promise<Project>,
  userRegistry?: Map<string, Resource>,
) {
  const original = controller.getSnapshot().project;
  const before = canonicalJson(original);
  const preview = await previewPatch(original, input, userRegistry);
  if (!preview.permissionDelta.every((p) => approvedCapabilities.includes(p)))
    throw Error("BLK-PATCH-003");
  if (hostValidate) {
    const checked = await hostValidate(
      original,
      preview.patch,
      approvedCapabilities,
    );
    if (canonicalJson(checked) !== canonicalJson(preview.next))
      throw Error("BLK-PATCH-002");
  }
  controller.edit((current) => {
    if (canonicalJson(current) !== before) throw Error("BLK-PATCH-001");
    Object.assign(current, preview.next);
  });
  return preview;
}
