import type {
  Project,
  Resource,
  WorkspaceBlock,
} from "@blocky/language-schema";
import { invalidResource, validResourceId, validateResource } from "./validate";

/** Returns a new project; user registry definitions never become project-owned data. */
export function upsertProjectResource(
  project: Project,
  input: unknown,
): Project {
  const resource = validateResource(input);
  if (resource.scope !== "project") invalidResource();
  const references = project.manifest.resources.filter(
    (item) => item.resourceId === resource.resourceId,
  );
  if (
    references.length > 1 ||
    references.some(
      (item) => item.scope !== "project" || item.kind !== resource.kind,
    )
  )
    invalidResource();
  const previous = project.resources[resource.resourceId];
  if (
    previous &&
    (previous.scope !== "project" || previous.kind !== resource.kind)
  )
    invalidResource();
  const result = structuredClone(project);
  result.resources[resource.resourceId] = resource;
  const reference = {
    resourceId: resource.resourceId,
    kind: resource.kind,
    scope: "project" as const,
    definitionRef: `resources/${resource.resourceId}.json`,
    secretRefs: [
      ...new Set(resource.secretBindings.map((item) => item.secretRef)),
    ],
  };
  const index = result.manifest.resources.findIndex(
    (item) => item.resourceId === resource.resourceId,
  );
  if (index < 0) result.manifest.resources.push(reference);
  else result.manifest.resources[index] = reference;
  return result;
}

export function removeProjectResource(project: Project, id: string): Project {
  if (!validResourceId(id)) invalidResource();
  const references = project.manifest.resources.filter(
    (item) => item.resourceId === id,
  );
  if (
    references.length !== 1 ||
    references[0].scope !== "project" ||
    !Object.hasOwn(project.resources, id)
  )
    invalidResource();
  const resource: Resource = validateResource(project.resources[id]);
  if (
    resource.scope !== "project" ||
    resource.resourceId !== id ||
    resource.kind !== references[0].kind
  )
    invalidResource();
  const result = structuredClone(project);
  delete result.resources[id];
  result.manifest.resources = result.manifest.resources.filter(
    (item) => item.resourceId !== id,
  );
  // Keep block references intact: compilation reports missing resources at their source.
  return result;
}

export type ResourceReferenceLocation = {
  moduleId: string;
  blockId: string;
  fieldId: string;
  resourceId: string;
};
export function analyzeResourceReferences(
  project: Project,
  resourceId: string,
): ResourceReferenceLocation[] {
  if (!validResourceId(resourceId)) invalidResource();
  const locations: ResourceReferenceLocation[] = [];
  for (const [moduleId, workspace] of Object.entries(project.workspaces)) {
    const visit = (block: WorkspaceBlock): void => {
      if (block.fields?.RESOURCE === resourceId)
        locations.push({
          moduleId,
          blockId: block.id,
          fieldId: "RESOURCE",
          resourceId,
        });
      for (const input of Object.values(block.inputs ?? {})) {
        if (input.block) visit(input.block);
        if (input.shadow) visit(input.shadow);
      }
      if (block.next?.block) visit(block.next.block);
    };
    workspace.blocks.blocks.forEach(visit);
  }
  return locations;
}
