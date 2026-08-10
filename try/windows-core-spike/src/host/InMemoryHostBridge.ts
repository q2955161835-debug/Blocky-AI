import type { HostBridge, SaveProjectRequest } from "./HostBridge";
import type { SpikeProjectSnapshot } from "../project/SpikeProjectSnapshot";

export class InMemoryHostBridge implements HostBridge {
  readonly #projects = new Map<string, string>();

  async saveProject(request: SaveProjectRequest): Promise<void> {
    this.#projects.set(request.projectId, request.json);
  }

  async loadProject(projectId: string): Promise<SpikeProjectSnapshot | null> {
    const json = this.#projects.get(projectId);
    return json ? JSON.parse(json) as SpikeProjectSnapshot : null;
  }
}
