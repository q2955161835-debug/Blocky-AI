import type { SpikeProjectSnapshot } from "../project/SpikeProjectSnapshot";

export interface SaveProjectRequest {
  readonly projectId: string;
  readonly json: string;
}

export interface HostBridge {
  saveProject(request: SaveProjectRequest): Promise<void>;
  loadProject(projectId: string): Promise<SpikeProjectSnapshot | null>;
}
