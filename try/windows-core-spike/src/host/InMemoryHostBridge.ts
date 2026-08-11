import type {
  DocumentRecord,
  HostBridge,
  SaveDocumentRequest,
  SaveProjectRequest,
} from "./HostBridge";
import type { SpikeProjectSnapshot } from "../project/SpikeProjectSnapshot";

interface QueuedOpenDocument {
  readonly json: string;
  readonly displayName: string;
}

interface InMemoryDocumentAssociation {
  readonly documentId: string;
  readonly displayName: string;
  readonly json: string;
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function blockyName(suggestedName: string): string {
  const trimmed = suggestedName.trim() || "未命名 Agent";
  return trimmed.toLocaleLowerCase("en-US").endsWith(".blocky")
    ? trimmed
    : `${trimmed}.blocky`;
}

export class InMemoryHostBridge implements HostBridge {
  readonly #projects = new Map<string, string>();
  readonly #openQueue: Array<QueuedOpenDocument | null> = [];
  #documentAssociation: InMemoryDocumentAssociation | null = null;
  #documentSequence = 0;
  #cancelNextSave = false;

  async saveProject(request: SaveProjectRequest): Promise<void> {
    this.#projects.set(request.projectId, request.json);
  }

  async loadProject(projectId: string): Promise<SpikeProjectSnapshot | null> {
    const json = this.#projects.get(projectId);
    return json ? JSON.parse(json) as SpikeProjectSnapshot : null;
  }

  queueOpen(json: string, displayName: string): void {
    this.#openQueue.push({ json, displayName: blockyName(displayName) });
  }

  queueCancelOpen(): void {
    this.#openQueue.push(null);
  }

  queueCancelSave(): void {
    this.#cancelNextSave = true;
  }

  async openDocument(): Promise<DocumentRecord | null> {
    const queued = this.#openQueue.shift() ?? null;
    if (!queued) return null;
    this.#documentSequence += 1;
    this.#documentAssociation = {
      documentId: `document-${this.#documentSequence}`,
      displayName: queued.displayName,
      json: queued.json,
    };
    return this.#record(this.#documentAssociation);
  }

  async saveDocument(request: SaveDocumentRequest): Promise<DocumentRecord | null> {
    if (this.#cancelNextSave) {
      this.#cancelNextSave = false;
      return null;
    }
    if (request.saveAs || !this.#documentAssociation) {
      this.#documentSequence += 1;
      this.#documentAssociation = {
        documentId: `document-${this.#documentSequence}`,
        displayName: blockyName(request.suggestedName),
        json: request.json,
      };
    } else {
      this.#documentAssociation = {
        ...this.#documentAssociation,
        json: request.json,
      };
    }
    return this.#record(this.#documentAssociation);
  }

  async clearDocumentAssociation(): Promise<void> {
    this.#documentAssociation = null;
  }

  async #record(
    association: InMemoryDocumentAssociation,
  ): Promise<DocumentRecord> {
    return {
      documentId: association.documentId,
      displayName: association.displayName,
      json: association.json,
      sha256: await sha256Hex(association.json),
      bytes: new TextEncoder().encode(association.json).byteLength,
      hasFileAssociation: true,
    };
  }
}
