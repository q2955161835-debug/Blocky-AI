import { catalog, catalogVersion, walkBlocks } from "@blocky/block-catalog";
import { compileProject } from "@blocky/compiler";
import { validRef, type Project, type Resource } from "@blocky/language-schema";
import { projectDigest } from "@blocky/project-model";
import { builderInputBudget, type BuilderRequest } from "./request";

/** Publishes whitelisted capabilities and public schemas; excludes bindings,
 * endpoints, process configuration and secrets. */
export async function inspectBuilder(
  project: Project,
  request: BuilderRequest,
  registry?: Map<string, Resource>,
) {
  const module = project.manifest.modules.find(
    (m) => m.moduleId === request.moduleId,
  );
  if (project.manifest.projectId !== request.projectId || !module)
    throw Error("BLK-BUILDER-002");
  const blocks = [
    ...walkBlocks(project.workspaces[module.moduleId].blocks.blocks),
  ];
  if (request.selection.some((id) => !blocks.some((b) => b.id === id)))
    throw Error("BLK-BUILDER-002");
  const compiled = await compileProject(project, registry);
  const declaredIds = new Set(
    project.manifest.resources.map((r) => r.resourceId),
  );
  const toolSchema = (resource: Resource, field: string) => {
    const reference = resource.definition[field];
    if (
      !reference ||
      typeof reference !== "object" ||
      Array.isArray(reference) ||
      reference.kind !== "schema" ||
      typeof reference.id !== "string"
    )
      return undefined;
    const path = `schemas/${reference.id}.json`;
    return validRef(path) && Object.hasOwn(project.schemas, path)
      ? project.schemas[path]
      : undefined;
  };
  const summaries = blocks.map((b) => ({
    id: b.id,
    type: b.type,
    fields: b.fields ?? {},
    disabled: !!b.disabled,
    inputs: Object.fromEntries(
      Object.entries(b.inputs ?? {}).map(([key, input]) => [
        key,
        input.block?.id ?? null,
      ]),
    ),
    next: b.next?.block?.id ?? null,
  }));
  const result = {
    projectId: request.projectId,
    projectName: project.manifest.displayName,
    baseDigest: await projectDigest(project),
    catalogVersion,
    module: {
      moduleId: module.moduleId,
      displayName: module.displayName,
      exports: module.exports,
    },
    blocks: summaries,
    selection: summaries.filter((b) => request.selection.includes(b.id)),
    resources: [
      ...Object.values(project.resources),
      ...[...(registry?.values() ?? [])],
    ]
      .filter((r) => declaredIds.has(r.resourceId))
      .map((r) => ({
        resourceId: r.resourceId,
        kind: r.kind,
        displayName: r.displayName,
        ...(r.kind === "model"
          ? {
              modelCapabilities: Array.isArray(r.definition.capabilities)
                ? r.definition.capabilities.filter(
                    (v) =>
                      typeof v === "string" &&
                      [
                        "text",
                        "tools",
                        "structured-output",
                        "embedding",
                        "rerank",
                        "image",
                        "audio",
                        "classify",
                        "score",
                      ].includes(v),
                  )
                : [],
            }
          : {}),
        ...(r.kind === "tool"
          ? {
              inputSchema: toolSchema(r, "inputSchemaRef"),
              outputSchema: toolSchema(r, "outputSchemaRef"),
            }
          : {}),
      })),
    catalog: catalog.map(
      ({ type, label, fields, inputs, requiredInputs, fieldOptions }) => ({
        type,
        label,
        fields,
        inputs,
        requiredInputs,
        fieldOptions,
      }),
    ),
    diagnostics: compiled.diagnostics.filter(
      (d) => !d.source?.moduleId || d.source.moduleId === request.moduleId,
    ),
  };
  builderInputBudget(result);
  return result;
}
export type BuilderInspection = Awaited<ReturnType<typeof inspectBuilder>>;
