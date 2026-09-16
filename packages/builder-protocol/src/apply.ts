import { canonicalJson } from "@blocky/language-schema";
import { ProjectController } from "@blocky/project-model";
import { previewPatch } from "./preview";
export async function applyPatch(
  controller: ProjectController,
  input: unknown,
  approvedCapabilities: string[],
) {
  const original = controller.getSnapshot().project;
  const before = canonicalJson(original);
  const preview = await previewPatch(original, input);
  if (!preview.permissionDelta.every((p) => approvedCapabilities.includes(p)))
    throw Error("BLK-PATCH-003");
  controller.edit((current) => {
    if (canonicalJson(current) !== before) throw Error("BLK-PATCH-001");
    Object.assign(current, preview.next);
  });
  return preview;
}
