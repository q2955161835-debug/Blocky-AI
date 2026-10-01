import { digest, type Project } from "@blocky/language-schema";
import {
  createCapabilityStarter,
  capabilityStarters,
} from "../capability-starters";
import { createOfficialStarter, officialStarters } from "../starters";
import {
  captureBlueprint,
  defaultBindings,
  instantiateBlueprint,
  parseBlueprint,
} from "./index";
export const knowledgeBlueprintStarters = capabilityStarters.filter((starter) =>
  ["knowledge-ingestion", "knowledge-correction"].includes(starter.id),
);
const starterProject = (id: string, projectId?: string) =>
  knowledgeBlueprintStarters.some((starter) => starter.id === id)
    ? createCapabilityStarter(id, projectId)
    : createOfficialStarter(id, projectId);
export async function officialBlueprint(id: string) {
  const project = starterProject(id, "official-blueprint-source");
  const captured = await captureBlueprint(
    project,
    "research-agent",
    ["research-root"],
    project.manifest.displayName,
    `official-${id}`,
  );
  const { digest: _, ...content } = captured;
  const value = {
    ...content,
    source: { kind: "official" as const, starterId: id },
    version: [...officialStarters, ...knowledgeBlueprintStarters].find(
      (s) => s.id === id,
    )!.version,
  };
  return parseBlueprint({ ...value, digest: await digest(value) });
}
export async function createBlueprintProject(
  id: string,
  projectId?: string,
): Promise<Project> {
  const project = starterProject(id, projectId),
    blueprint = await officialBlueprint(id);
  const original = project.workspaces["research-agent"].blocks.blocks[0];
  project.workspaces["research-agent"].blocks.blocks = [];
  project.workspaces["research-agent"].blocks.blocks =
    await instantiateBlueprint(
      blueprint,
      project,
      "research-agent",
      defaultBindings(blueprint),
      { x: original.x ?? 80, y: original.y ?? 70 },
      (sourceId) => sourceId,
    );
  return project;
}
