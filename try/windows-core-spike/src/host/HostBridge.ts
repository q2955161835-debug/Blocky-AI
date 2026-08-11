import type { SpikeProjectSnapshot } from "../project/SpikeProjectSnapshot";

export interface SaveProjectRequest {
  readonly projectId: string;
  readonly json: string;
}

export interface DocumentRecord {
  readonly documentId: string;
  readonly displayName: string;
  readonly json: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly hasFileAssociation: boolean;
}

export interface SaveDocumentRequest {
  readonly json: string;
  readonly suggestedName: string;
  readonly saveAs: boolean;
}

export interface HostBridge {
  saveProject(request: SaveProjectRequest): Promise<void>;
  loadProject(projectId: string): Promise<SpikeProjectSnapshot | null>;
  openDocument(): Promise<DocumentRecord | null>;
  saveDocument(request: SaveDocumentRequest): Promise<DocumentRecord | null>;
  clearDocumentAssociation(): Promise<void>;
}
