import type { SpikeProjectSnapshot } from "../project/SpikeProjectSnapshot";

export interface SaveProjectRequest {
  readonly project: SpikeProjectSnapshot;
}

export interface HostBridge {
  saveProject(request: SaveProjectRequest): Promise<void>;
  loadProject(projectId: string): Promise<SpikeProjectSnapshot | null>;
}
