import type { Project, Resource } from "@blocky/language-schema";
import { canonicalJson } from "@blocky/language-schema";
import { validateResource, invalidResource } from "./validate";
export type UserRegistry = {
  schemaVersion: "blocky.resource-registry/v1";
  resources: Resource[];
};
export const emptyRegistry = (): UserRegistry => ({
  schemaVersion: "blocky.resource-registry/v1",
  resources: [],
});
export function parseRegistry(value: unknown): UserRegistry {
  const doc = value as UserRegistry;
  if (
    !doc ||
    doc.schemaVersion !== "blocky.resource-registry/v1" ||
    !Array.isArray(doc.resources) ||
    doc.resources.length > 256 ||
    Object.keys(doc).some((k) => !["schemaVersion", "resources"].includes(k))
  )
    invalidResource();
  const resources = doc.resources.map(validateResource);
  if (
    resources.some((r) => r.scope !== "user") ||
    new Set(resources.map((r) => r.resourceId)).size !== resources.length
  )
    invalidResource();
  return { schemaVersion: doc.schemaVersion, resources };
}
export function upsertUserResource(
  registry: UserRegistry,
  value: unknown,
): UserRegistry {
  const resource = validateResource(value);
  if (
    resource.scope !== "user" ||
    registry.resources.some(
      (r) => r.resourceId === resource.resourceId && r.kind !== resource.kind,
    )
  )
    invalidResource();
  return parseRegistry({
    ...registry,
    resources: [
      ...registry.resources.filter((r) => r.resourceId !== resource.resourceId),
      resource,
    ],
  });
}
export function referenceUserResource(
  project: Project,
  value: unknown,
): Project {
  const resource = validateResource(value);
  if (
    resource.scope !== "user" ||
    project.manifest.resources.some(
      (r) =>
        r.resourceId === resource.resourceId &&
        (r.scope !== "user" || r.kind !== resource.kind),
    )
  )
    invalidResource();
  const result = structuredClone(project);
  if (resource.kind === "tool") {
    for (const prefix of ["input", "output"] as const) {
      const schemaText = resource.definition[`${prefix}SchemaJson`];
      const reference = resource.definition[`${prefix}SchemaRef`];
      if (typeof schemaText !== "string") continue;
      if (
        !reference ||
        typeof reference !== "object" ||
        Array.isArray(reference) ||
        typeof reference.id !== "string"
      )
        invalidResource();
      const schema = JSON.parse(schemaText);
      const path = `schemas/${reference.id}.json`;
      if (
        Object.hasOwn(result.schemas, path) &&
        canonicalJson(result.schemas[path]) !== canonicalJson(schema)
      )
        throw Error("BLK-RESOURCE-SCHEMA-CONFLICT");
      result.schemas[path] = schema;
    }
  }
  result.manifest.resources = [
    ...result.manifest.resources.filter(
      (r) => r.resourceId !== resource.resourceId,
    ),
    {
      resourceId: resource.resourceId,
      kind: resource.kind,
      scope: "user",
      definitionRef: resource.resourceId,
      secretRefs: [...new Set(resource.secretBindings.map((b) => b.secretRef))],
    },
  ];
  return result;
}
