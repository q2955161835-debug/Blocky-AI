import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  buildEditorProjection,
  type BlocklyCanvasHandle,
} from "../../src/blockly/BlocklyCanvas";
import { createHundredBlockWorkspaceState } from "../../src/blockly/fixtures";
import { useSpikeController } from "../../src/app/useSpikeController";
import type { HostBridge } from "../../src/host/HostBridge";
import { InMemoryHostBridge } from "../../src/host/InMemoryHostBridge";

const VALID_WORKSPACE = {
  blocks: {
    languageVersion: 0,
    blocks: [
      {
        id: "agent-1",
        type: "core.agent.define",
        inputs: {
          MEMBERS: {
            block: {
              id: "entry-1",
              type: "core.interaction.chat_entry",
              fields: { NAME: "输入 1" },
              inputs: {
                CAPABILITIES: {
                  block: {
                    id: "accept-text",
                    type: "core.interaction.accept_text",
                  },
                },
                HANDLER: {
                  block: {
                    id: "reply-1",
                    type: "core.message.reply",
                    inputs: {
                      MESSAGE: {
                        block: {
                          id: "message-1",
                          type: "core.message.create",
                          inputs: {
                            CONTENT: {
                              block: {
                                id: "literal-1",
                                type: "core.data.literal",
                                fields: { VALUE: "固定课程回复" },
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    ],
  },
};

function canvasHandle(
  highlight = vi.fn(),
  workspace: ReturnType<typeof createHundredBlockWorkspaceState> | typeof VALID_WORKSPACE = VALID_WORKSPACE,
): BlocklyCanvasHandle {
  return {
    load: vi.fn(),
    save: vi.fn(() => workspace),
    blockCount: vi.fn(() => 4),
    highlight,
    insertBlock: vi.fn(() => null),
    undo: vi.fn(),
    redo: vi.fn(),
    canUndo: vi.fn(() => false),
    canRedo: vi.fn(() => false),
    canPaste: vi.fn(() => false),
    setTool: vi.fn(),
    getTool: vi.fn(() => "select" as const),
    selectAll: vi.fn(),
    cutSelection: vi.fn(),
    copySelection: vi.fn(),
    pasteSelection: vi.fn(),
    deleteSelection: vi.fn(),
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
    resetZoom: vi.fn(),
    fitToView: vi.fn(),
    resizePreservingView: vi.fn(),
    captureViewState: vi.fn(() => ({
      scale: 0.9,
      scrollX: 0,
      scrollY: 0,
      topBlocks: [],
    })),
  };
}

describe("useSpikeController", () => {
  it("synchronously highlights each real runtime block event and clears on terminal", async () => {
    const highlight = vi.fn();
    const canvasRef = { current: canvasHandle(highlight) };
    const { result } = renderHook(() =>
      useSpikeController({
        canvasRef,
        hostBridge: new InMemoryHostBridge(),
        projectId: "project-1",
      }),
    );

    act(() => result.current.acceptProjection(buildEditorProjection(VALID_WORKSPACE)));
    await waitFor(() => expect(result.current.activeEntryId).toBe("entry-1"));
    highlight.mockClear();

    let outcome: { runId: string } | undefined;
    await act(async () => {
      outcome = await result.current.runInput({
        entryId: "entry-1",
        text: "你好",
        attachments: [],
      });
    });

    expect(outcome).toEqual({ runId: "desktop-run-1" });
    expect(result.current.submissions).toEqual([{
      runId: "desktop-run-1",
      entryId: "entry-1",
      userText: "你好",
    }]);

    expect(result.current.runtime.events.map((event) => event.type)).toEqual([
      "run.started",
      "block.started",
      "block.started",
      "block.started",
      "block.completed",
      "block.started",
      "block.started",
      "block.started",
      "block.completed",
      "block.completed",
      "model.chunk",
      "block.completed",
      "block.completed",
      "block.completed",
      "run.completed",
    ]);
    expect(highlight.mock.calls.map(([blockId]) => blockId)).toEqual([
      "agent-1",
      "entry-1",
      "accept-text",
      "reply-1",
      "message-1",
      "literal-1",
      null,
    ]);
  });

  it("keeps the simulated error command failing through the selected UI entry", async () => {
    const highlight = vi.fn();
    const canvasRef = { current: canvasHandle(highlight) };
    const { result } = renderHook(() =>
      useSpikeController({
        canvasRef,
        hostBridge: new InMemoryHostBridge(),
        projectId: "project-1",
      }),
    );

    act(() => result.current.acceptProjection(buildEditorProjection(VALID_WORKSPACE)));
    await waitFor(() => expect(result.current.activeEntryId).toBe("entry-1"));
    highlight.mockClear();

    await act(async () => {
      await expect(result.current.runInput({
        entryId: "entry-1",
        text: "/error",
        attachments: [],
      })).rejects.toThrow("RUN_FAILED");
    });

    expect(result.current.runtime.events.at(-1)).toMatchObject({
      type: "run.failed",
      blockId: "agent-1",
      data: { code: "MODEL_SIMULATED_FAILURE" },
    });
    expect(result.current.runtime.events.some((event) => event.type === "model.chunk")).toBe(false);
    expect(highlight.mock.calls.map(([blockId]) => blockId)).toEqual(["agent-1", null]);
  });

  it("surfaces fixed operation errors while keeping rejection details private", async () => {
    const rejectingHost: HostBridge = {
      saveProject: async () => {
        throw new Error("SECRET_SAVE_DETAIL");
      },
      loadProject: async () => {
        throw new Error("SECRET_LOAD_DETAIL");
      },
      openDocument: async () => {
        throw new Error("SECRET_OPEN_DETAIL");
      },
      saveDocument: async () => {
        throw new Error("SECRET_DOCUMENT_SAVE_DETAIL");
      },
      clearDocumentAssociation: async () => {},
    };
    const canvasRef = { current: canvasHandle() };
    const { result } = renderHook(() =>
      useSpikeController({ canvasRef, hostBridge: rejectingHost, projectId: "project-1" }),
    );

    await act(async () => {
      await expect(result.current.saveProject()).resolves.toBeUndefined();
    });
    expect(result.current.operationError).toBe("保存失败，请重试");

    await act(async () => {
      await expect(result.current.loadProject()).resolves.toBeUndefined();
    });
    expect(result.current.operationError).toBe("载入失败，请重试");

    act(() => result.current.acceptProjection(buildEditorProjection(VALID_WORKSPACE)));
    await waitFor(() => expect(result.current.activeEntryId).toBe("entry-1"));
    await act(async () => {
      await expect(
        result.current.runInput({ entryId: "missing-entry", attachments: [] }),
      ).rejects.toThrow("RUN_ENTRY_NOT_FOUND");
    });
    expect(result.current.operationError).toBe("运行失败，请检查积木后重试");
    expect(result.current.operationError).not.toMatch(/SECRET|RUN_ENTRY_NOT_FOUND/);
  });

  it("rejects a real cancelled run without turning cancellation into an error alert", async () => {
    const canvasRef = { current: canvasHandle() };
    const { result } = renderHook(() =>
      useSpikeController({
        canvasRef,
        hostBridge: new InMemoryHostBridge(),
        projectId: "project-1",
      }),
    );

    act(() => result.current.acceptProjection(buildEditorProjection(VALID_WORKSPACE)));
    await waitFor(() => expect(result.current.activeEntryId).toBe("entry-1"));

    await act(async () => {
      const firstRun = result.current.runInput({
        entryId: "entry-1",
        text: "将被取消",
        attachments: [],
      });
      const secondRun = result.current.runInput({
        entryId: "entry-1",
        text: "后续成功",
        attachments: [],
      });
      await expect(firstRun).rejects.toThrow("RUN_CANCELLED");
      await expect(secondRun).resolves.toEqual({ runId: "desktop-run-2" });
    });
    expect(result.current.runtime.events.map((event) => event.type)).toContain(
      "run.cancelled",
    );
    expect(result.current.operationError).toBeNull();
  });

  it("does not let stale approval callbacks resolve a newer run", async () => {
    const canvasRef = {
      current: canvasHandle(vi.fn(), createHundredBlockWorkspaceState()),
    };
    const { result } = renderHook(() =>
      useSpikeController({
        canvasRef,
        hostBridge: new InMemoryHostBridge(),
        projectId: "project-1",
      }),
    );
    act(() => {
      result.current.acceptProjection(
        buildEditorProjection(createHundredBlockWorkspaceState()),
      );
    });
    await waitFor(() => expect(result.current.activeEntryId).toBe("block-002"));

    let firstRun!: Promise<{ readonly runId: string }>;
    act(() => {
      firstRun = result.current.runInput({
        entryId: "block-002",
        text: "/permission",
        attachments: [],
      });
    });
    await waitFor(() => expect(result.current.pendingPermission).not.toBeNull());
    const staleApprove = result.current.approvePermission;
    const staleDeny = result.current.denyPermission;
    await act(async () => {
      await result.current.cancelRun();
      await expect(firstRun).rejects.toThrow("RUN_CANCELLED");
    });

    let secondRun!: Promise<{ readonly runId: string }>;
    act(() => {
      secondRun = result.current.runInput({
        entryId: "block-002",
        text: "/permission",
        attachments: [],
      });
    });
    await waitFor(() => {
      expect(result.current.pendingPermission?.runId).toBe("desktop-run-2");
    });

    act(() => {
      staleApprove();
      staleDeny();
    });
    expect(result.current.pendingPermission?.runId).toBe("desktop-run-2");
    expect(result.current.runtime.events.at(-1)?.type).toBe(
      "tool.permission_requested",
    );

    await act(async () => {
      result.current.denyPermission();
      await expect(secondRun).rejects.toThrow("RUN_FAILED");
    });
  });
});
