import { act, renderHook } from "@testing-library/react";
import { createRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BlocklyCanvasHandle } from "../../src/blockly/BlocklyCanvas";
import { stableStringify, type JsonValue } from "../../src/core/json";
import { InMemoryHostBridge } from "../../src/host/InMemoryHostBridge";
import { createSpikeProjectSnapshot } from "../../src/project/SpikeProjectSnapshot";
import { buildEditorProjection } from "../../src/blockly/BlocklyCanvas";
import { useDocumentSession } from "../../src/app/useDocumentSession";

const EMPTY_WORKSPACE: JsonValue = {
  blocks: { blocks: [], languageVersion: 0 },
};
const OPENED_WORKSPACE: JsonValue = {
  blocks: { blocks: [], languageVersion: 1 },
};

function snapshotJson(workspace: JsonValue): string {
  const projection = buildEditorProjection(workspace);
  return stableStringify(createSpikeProjectSnapshot({
    projectId: "windows-core-spike",
    workspace,
    program: projection.program,
    interactionManifest: projection.interactionManifest,
  }));
}

function createCanvas(workspace: JsonValue = EMPTY_WORKSPACE) {
  let current = workspace;
  return {
    load: vi.fn((next: JsonValue) => {
      current = next;
    }),
    save: vi.fn(() => current),
  };
}

describe("useDocumentSession", () => {
  let host: InMemoryHostBridge;
  let canvas: ReturnType<typeof createCanvas>;
  const cancelRun = vi.fn(async () => {});
  const onClose = vi.fn();

  beforeEach(() => {
    host = new InMemoryHostBridge();
    canvas = createCanvas();
    cancelRun.mockClear();
    onClose.mockClear();
  });

  function renderSession() {
    const canvasRef = createRef<BlocklyCanvasHandle>();
    canvasRef.current = canvas as unknown as BlocklyCanvasHandle;
    return renderHook(() => useDocumentSession({
      canvasRef,
      hostBridge: host,
      projectId: "windows-core-spike",
      cancelRun,
      onClose,
      initialWorkspace: EMPTY_WORKSPACE,
    }));
  }

  it("guards dirty open and cancel leaves the canvas untouched", async () => {
    host.queueOpen(snapshotJson(OPENED_WORKSPACE), "weather.blocky");
    const { result } = renderSession();

    await act(() => result.current.openDocument());
    expect(result.current.pendingIntent).toBe("open");
    await act(() => result.current.resolveUnsavedDecision("cancel"));

    expect(result.current.pendingIntent).toBeNull();
    expect(canvas.load).not.toHaveBeenCalled();
    expect(cancelRun).not.toHaveBeenCalled();
  });

  it("discards dirty state, opens the chosen document, and establishes a clean baseline", async () => {
    host.queueOpen(snapshotJson(OPENED_WORKSPACE), "weather.blocky");
    const { result } = renderSession();

    await act(() => result.current.openDocument());
    await act(() => result.current.resolveUnsavedDecision("discard"));

    expect(cancelRun).toHaveBeenCalledTimes(1);
    expect(canvas.load).toHaveBeenCalledWith(OPENED_WORKSPACE);
    expect(result.current.state).toMatchObject({
      displayName: "weather.blocky",
      saveState: "clean",
      hasFileAssociation: true,
    });
  });

  it("saves the canonical snapshot and uses Save rather than Save As after association", async () => {
    const save = vi.spyOn(host, "saveDocument");
    const { result } = renderSession();

    await act(() => result.current.saveDocument());
    expect(save).toHaveBeenCalledWith(expect.objectContaining({
      saveAs: false,
      suggestedName: "未命名 Agent",
      json: expect.stringContaining("blocky.spike-project/v1"),
    }));
    expect(result.current.state.saveState).toBe("clean");
    expect(result.current.label).toBe("未命名 Agent.blocky · 已保存");

    await act(() => result.current.saveDocument());
    expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ saveAs: false }));
  });

  it("does not continue a guarded close when saving is cancelled", async () => {
    host.queueCancelSave();
    const { result } = renderSession();
    await act(() => result.current.requestClose());
    await act(() => result.current.resolveUnsavedDecision("save"));

    expect(onClose).not.toHaveBeenCalled();
    expect(result.current.pendingIntent).toBe("close");
    expect(result.current.state.saveState).toBe("dirty");
  });
});
