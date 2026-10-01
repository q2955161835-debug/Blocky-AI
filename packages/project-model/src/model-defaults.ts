import type { Project, Resource } from "@blocky/language-schema";
import { walkBlocks } from "@blocky/block-catalog";
import {
  configuredOnlineModel,
  referenceUserResource,
} from "@blocky/resource-registry";

/** Called only for a newly created starter; opening a project never applies local defaults. */
export function applyDefaultModel(
  project: Project,
  id: string,
  registry: ReadonlyMap<string, Resource>,
): Project {
  const modelField = (type: string) =>
    type === "core.knowledge.correct"
      ? "MODEL"
      : ["core.model.compose", "core.reason.tool_loop"].includes(type)
        ? "RESOURCE"
        : undefined;
  if (
    !id ||
    !Object.values(project.workspaces).some((workspace) =>
      [...walkBlocks(workspace.blocks.blocks)].some((block) =>
        modelField(block.type),
      ),
    )
  )
    return project;
  const resource = configuredOnlineModel(id, registry);
  const result = referenceUserResource(project, resource);
  for (const workspace of Object.values(result.workspaces)) {
    for (const block of walkBlocks(workspace.blocks.blocks)) {
      const field = modelField(block.type);
      if (field) block.fields = { ...block.fields, [field]: id };
    }
  }
  return result;
}
