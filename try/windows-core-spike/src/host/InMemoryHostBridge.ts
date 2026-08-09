import type { HostBridge, SaveProjectRequest } from "./HostBridge";
import type { SpikeProjectSnapshot } from "../project/SpikeProjectSnapshot";

export class InMemoryHostBridge implements HostBridge {
  readonly #projects = new Map<string, SpikeProjectSnapshot>();

  async saveProject(request: SaveProjectRequest): Promise<void> {
    this.#projects.set(request.project.projectId, structuredClone(request.project));
  }

  async loadProject(projectId: string): Promise<SpikeProjectSnapshot | null> {
    const project = this.#projects.get(projectId);
    return project ? structuredClone(project) : null;
  }
}
