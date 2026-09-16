import type { Project, Resource } from "@blocky/language-schema";
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
    resource.secretBindings.some(
      (b) => !reference.secretRefs.includes(b.secretRef),
    )
  )
    throw Error("BLK-RESOURCE-002");
  return structuredClone(resource);
}
