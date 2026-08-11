import {
  useCallback,
  useRef,
  useState,
  type RefObject,
} from "react";
import {
  buildEditorProjection,
  type BlocklyCanvasHandle,
} from "../blockly/BlocklyCanvas";
import { stableStringify, type JsonValue } from "../core/json";
import type { HostBridge } from "../host/HostBridge";
import { createSpikeProjectSnapshot } from "../project/SpikeProjectSnapshot";
import {
  createUntitledSession,
  formatDocumentLabel,
  reduceDocumentSession,
  type DocumentSessionAction,
  type DocumentSessionState,
  type PendingDocumentIntent,
  type UnsavedDecision,
} from "./DocumentSession";

const EMPTY_WORKSPACE: JsonValue = {
  blocks: { blocks: [], languageVersion: 0 },
};

interface UseDocumentSessionOptions {
  readonly canvasRef: RefObject<BlocklyCanvasHandle | null>;
  readonly hostBridge: HostBridge;
  readonly projectId: string;
  readonly cancelRun: () => Promise<void>;
  readonly onClose: () => void;
  readonly initialWorkspace?: JsonValue;
}

function workspaceFromDocument(json: string): JsonValue {
  const parsed: unknown = JSON.parse(json);
  if (
    !parsed ||
    typeof parsed !== "object" ||
    !("workspace" in parsed)
  ) {
    throw new Error("DOCUMENT_PROJECT_INVALID");
  }
  return (parsed as { readonly workspace: JsonValue }).workspace;
}

export function useDocumentSession({
  canvasRef,
  hostBridge,
  projectId,
  cancelRun,
  onClose,
  initialWorkspace = EMPTY_WORKSPACE,
}: UseDocumentSessionOptions) {
  const initialDigestRef = useRef(stableStringify(initialWorkspace));
  const [state, setState] = useState<DocumentSessionState>(() =>
    createUntitledSession(initialDigestRef.current),
  );
  const stateRef = useRef(state);
  stateRef.current = state;
  const [pendingIntent, setPendingIntent] =
    useState<PendingDocumentIntent>(null);
  const operationQueueRef = useRef<Promise<void>>(Promise.resolve());

  const commit = useCallback((action: DocumentSessionAction): void => {
    const next = reduceDocumentSession(stateRef.current, action);
    stateRef.current = next;
    setState(next);
  }, []);

  const runSerialized = useCallback(<T,>(operation: () => Promise<T>): Promise<T> => {
    const next = operationQueueRef.current.then(operation, operation);
    operationQueueRef.current = next.then(() => undefined, () => undefined);
    return next;
  }, []);

  const acceptWorkspace = useCallback((workspace: JsonValue): void => {
    commit({ type: "workspaceAccepted", digest: stableStringify(workspace) });
  }, [commit]);

  const save = useCallback(async (saveAs: boolean): Promise<boolean> => {
    const workspace = canvasRef.current?.save();
    if (!workspace) return false;
    const projection = buildEditorProjection(workspace);
    const digest = stableStringify(projection.workspace);
    const project = createSpikeProjectSnapshot({
      projectId,
      workspace: projection.workspace,
      program: projection.program,
      interactionManifest: projection.interactionManifest,
    });
    commit({ type: "workspaceAccepted", digest });
    commit({ type: "saveStarted" });
    try {
      const record = await hostBridge.saveDocument({
        json: stableStringify(project),
        suggestedName: stateRef.current.displayName,
        saveAs,
      });
      if (!record) {
        commit({ type: "workspaceAccepted", digest: stateRef.current.currentDigest });
        return false;
      }
      commit({
        type: "saveSucceeded",
        documentId: record.documentId,
        displayName: record.displayName,
        hasFileAssociation: record.hasFileAssociation,
        savedDigest: digest,
      });
      return true;
    } catch (error) {
      commit({ type: "saveFailed" });
      throw error;
    }
  }, [canvasRef, commit, hostBridge, projectId]);

  const saveDocument = useCallback(
    () => runSerialized(() => save(false)),
    [runSerialized, save],
  );
  const saveDocumentAs = useCallback(
    () => runSerialized(() => save(true)),
    [runSerialized, save],
  );

  const performIntent = useCallback(async (
    intent: Exclude<PendingDocumentIntent, null>,
  ): Promise<boolean> => {
    await cancelRun();
    if (intent === "close") {
      onClose();
      return true;
    }
    if (intent === "new") {
      await hostBridge.clearDocumentAssociation();
      const digest = stableStringify(EMPTY_WORKSPACE);
      commit({ type: "newDocument", digest });
      canvasRef.current?.load(EMPTY_WORKSPACE);
      return true;
    }

    const record = await hostBridge.openDocument();
    if (!record) return false;
    const workspace = workspaceFromDocument(record.json);
    const digest = stableStringify(workspace);
    commit({
      type: "documentOpened",
      documentId: record.documentId,
      displayName: record.displayName,
      digest,
      hasFileAssociation: record.hasFileAssociation,
    });
    canvasRef.current?.load(workspace);
    return true;
  }, [cancelRun, canvasRef, commit, hostBridge, onClose]);

  const requestIntent = useCallback((
    intent: Exclude<PendingDocumentIntent, null>,
  ): Promise<boolean> => {
    if (stateRef.current.saveState !== "clean") {
      setPendingIntent(intent);
      return Promise.resolve(false);
    }
    return runSerialized(() => performIntent(intent));
  }, [performIntent, runSerialized]);

  const newDocument = useCallback(
    () => requestIntent("new"),
    [requestIntent],
  );
  const openDocument = useCallback(
    () => requestIntent("open"),
    [requestIntent],
  );
  const requestClose = useCallback(
    () => requestIntent("close"),
    [requestIntent],
  );

  const resolveUnsavedDecision = useCallback(async (
    decision: UnsavedDecision,
  ): Promise<void> => {
    const intent = pendingIntent;
    if (!intent) return;
    if (decision === "cancel") {
      setPendingIntent(null);
      return;
    }
    await runSerialized(async () => {
      if (decision === "save" && !await save(false)) return;
      if (await performIntent(intent)) setPendingIntent(null);
    });
  }, [pendingIntent, performIntent, runSerialized, save]);

  return {
    state,
    label: formatDocumentLabel(state),
    pendingIntent,
    acceptWorkspace,
    newDocument,
    openDocument,
    saveDocument,
    saveDocumentAs,
    requestClose,
    resolveUnsavedDecision,
  };
}
