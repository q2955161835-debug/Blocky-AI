import { catalog, catalogVersion, walkBlocks } from "@blocky/block-catalog";
import { compileProject } from "@blocky/compiler";
import type { Project, Resource } from "@blocky/language-schema";
import { projectDigest } from "@blocky/project-model";
import { builderInputBudget, type BuilderRequest } from "./request";

/** Deliberately excludes resource definitions, bindings, local paths and secrets. */
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
    ].map((r) => ({
      resourceId: r.resourceId,
      kind: r.kind,
      displayName: r.displayName,
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
