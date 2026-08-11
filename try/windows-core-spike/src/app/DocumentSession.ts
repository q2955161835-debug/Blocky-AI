export type DocumentSaveState = "clean" | "dirty" | "saving" | "error";

export interface DocumentSessionState {
  readonly documentId: string;
  readonly displayName: string;
  readonly saveState: DocumentSaveState;
  readonly hasFileAssociation: boolean;
  readonly savedDigest: string | null;
  readonly currentDigest: string;
}

export type PendingDocumentIntent = "new" | "open" | "close" | null;
export type UnsavedDecision = "save" | "discard" | "cancel";

export type DocumentSessionAction =
  | { readonly type: "workspaceAccepted"; readonly digest: string }
  | { readonly type: "saveStarted" }
  | { readonly type: "saveFailed" }
  | {
      readonly type: "saveSucceeded";
      readonly documentId: string;
      readonly displayName: string;
      readonly hasFileAssociation: boolean;
      readonly savedDigest: string;
    }
  | {
      readonly type: "documentOpened";
      readonly documentId: string;
      readonly displayName: string;
      readonly digest: string;
      readonly hasFileAssociation: boolean;
    }
  | { readonly type: "newDocument"; readonly digest: string };

export function createUntitledSession(
  currentDigest: string,
): DocumentSessionState {
  return {
    documentId: "untitled",
    displayName: "未命名 Agent",
    saveState: "dirty",
    hasFileAssociation: false,
    savedDigest: null,
    currentDigest,
  };
}

export function reduceDocumentSession(
  state: DocumentSessionState,
  action: DocumentSessionAction,
): DocumentSessionState {
  switch (action.type) {
    case "workspaceAccepted":
      return {
        ...state,
        currentDigest: action.digest,
        saveState: state.savedDigest === action.digest ? "clean" : "dirty",
      };
    case "saveStarted":
      return { ...state, saveState: "saving" };
    case "saveFailed":
      return { ...state, saveState: "error" };
    case "saveSucceeded":
      return {
        ...state,
        documentId: action.documentId,
        displayName: action.displayName,
        hasFileAssociation: action.hasFileAssociation,
        savedDigest: action.savedDigest,
        saveState: state.currentDigest === action.savedDigest ? "clean" : "dirty",
      };
    case "documentOpened":
      return {
        documentId: action.documentId,
        displayName: action.displayName,
        saveState: "clean",
        hasFileAssociation: action.hasFileAssociation,
        savedDigest: action.digest,
        currentDigest: action.digest,
      };
    case "newDocument":
      return createUntitledSession(action.digest);
  }
}

export function formatDocumentLabel(state: DocumentSessionState): string {
  const suffix = state.saveState === "clean"
    ? "已保存"
    : state.saveState === "saving"
      ? "正在保存…"
      : state.saveState === "error"
        ? "保存失败"
        : "未保存";
  return `${state.displayName} · ${suffix}`;
}
