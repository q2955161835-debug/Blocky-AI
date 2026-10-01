import type { Project, Resource } from "@blocky/language-schema";
import { validateResource } from "./validate";
import { isResolvedConnection } from "./model-providers";
export * from "./model-providers";
export { validateResource } from "./validate";
export { implementationKey } from "./implementation";
export * from "./user-registry";
export { isUserOnlineModel, configuredOnlineModel } from "./model-defaults";
export { resourceDefinitions } from "./definitions";
export type {
  ResourceKind,
  ResourceDefinition,
  ResourceFieldSchema,
} from "./definitions";
export {
  upsertProjectResource,
  removeProjectResource,
  analyzeResourceReferences,
} from "./project-resources";
export type { ResourceReferenceLocation } from "./project-resources";
export function resolveResource(
  project: Project,
  id: string,
  kind: string,
  userRegistry = new Map<string, Resource>(),
): Resource {
  const reference = project.manifest.resources.find(
    (r) => r.resourceId === id && r.kind === kind,
  );
  if (!reference) throw Error("BLK-RESOURCE-001");
  const resource =
    reference.scope === "project"
      ? project.resources[id]
      : userRegistry.get(reference.definitionRef);
  if (
    !resource ||
    resource.resourceId !== id ||
    resource.scope !== reference.scope ||
    resource.kind !== kind
  )
    throw Error("BLK-RESOURCE-001");
  if (
    !isResolvedConnection(resource) && resource.secretBindings.some(
      (b) => !reference.secretRefs.includes(b.secretRef),
    )
  )
    throw Error("BLK-RESOURCE-002");
  return validateResource(resource);
}
