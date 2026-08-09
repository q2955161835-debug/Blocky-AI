import type { InteractionManifest } from "../core/interactionManifest";
import type { BlockyProgram } from "../core/ir";
import { canonicalizeJson, type JsonValue } from "../core/json";

export interface SpikeProjectSnapshot {
  readonly schemaVersion: "blocky.spike-project/v1";
  readonly projectId: string;
  readonly workspace: JsonValue;
  readonly program: BlockyProgram;
  readonly interactionManifest: InteractionManifest;
}

export function createSpikeProjectSnapshot(input: {
  projectId: string;
  workspace: JsonValue;
  program: BlockyProgram;
  interactionManifest: InteractionManifest;
}): SpikeProjectSnapshot {
  return {
    schemaVersion: "blocky.spike-project/v1",
    projectId: input.projectId,
    workspace: canonicalizeJson(input.workspace),
    program: input.program,
    interactionManifest: input.interactionManifest,
  };
}
