import { describe, expect, it } from "vitest";
import { buildEditorProjection } from "../../src/blockly/BlocklyCanvas";
import {
  assertRunnableProjection,
  createRuntimeToolMap,
  reduceRuntimeEvent,
  type RuntimeViewState,
} from "../../src/app/useSpikeController";
import { createRuntimeEvent } from "../../src/core/runtimeEvents";
import { InMemoryHostBridge } from "../../src/host/InMemoryHostBridge";
import { createSpikeProjectSnapshot } from "../../src/project/SpikeProjectSnapshot";

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
                  block: { id: "send-1", type: "core.message.send" },
                },
              },
            },
          },
        },
      },
      {
        id: "tool-1",
        type: "core.tool.define",
        fields: { TOOL_ID: "tool.identity" },
      },
    ],
  },
};

describe("Task 7 foundations", () => {
  it("creates a deeply immutable editor projection from one canonical workspace snapshot", () => {
    const projection = buildEditorProjection(VALID_WORKSPACE);

    expect(projection.interactionManifest.entries.map((entry) => entry.id)).toEqual([
      "entry-1",
    ]);
    expect(projection.diagnostics).toEqual([]);
    expect(Object.isFrozen(projection)).toBe(true);
    expect(Object.isFrozen(projection.workspace)).toBe(true);
    expect(Object.isFrozen(projection.program.roots[0])).toBe(true);
    expect(Object.isFrozen(projection.diagnostics)).toBe(true);
  });

  it("rejects compile errors and stale entry IDs before the runtime starts", () => {
    const valid = buildEditorProjection(VALID_WORKSPACE);
    const invalid = buildEditorProjection({ blocks: { blocks: "not-an-array" } });

    expect(() => assertRunnableProjection(invalid, "entry-1")).toThrow(
      "RUN_BLOCKED_BY_DIAGNOSTICS",
    );
    expect(() => assertRunnableProjection(valid, "missing-entry")).toThrow(
      "RUN_ENTRY_NOT_FOUND",
    );
    expect(assertRunnableProjection(valid, "entry-1").id).toBe("entry-1");
  });

  it("rebuilds the runtime Map without cloning frozen Tool contract identities", () => {
    const projection = buildEditorProjection(VALID_WORKSPACE);
    const tools = createRuntimeToolMap(projection);

    expect(projection.toolContracts).toHaveLength(1);
    expect(tools.get("tool.identity")).toBe(projection.toolContracts[0]);
  });

  it("uses the event reducer as the single highlight and terminal-state source", () => {
    const initial: RuntimeViewState = {
      activeBlockId: null,
      events: [],
      status: "idle",
    };
    const started = createRuntimeEvent({
      runId: "run-1",
      sequence: 1,
      type: "block.started",
      blockId: "block-1",
    });
    const completed = createRuntimeEvent({
      runId: "run-1",
      sequence: 2,
      type: "run.completed",
    });

    const running = reduceRuntimeEvent(initial, started);
    expect(running).toMatchObject({
      activeBlockId: "block-1",
      status: "running",
    });
    const terminal = reduceRuntimeEvent(running, completed);
    expect(terminal).toMatchObject({
      activeBlockId: null,
      status: "run.completed",
    });
    expect(terminal.events).toEqual([started, completed]);
  });

  it("keeps only the latest 200 events in sequence order", () => {
    let state: RuntimeViewState = {
      activeBlockId: null,
      events: [],
      status: "idle",
    };
    for (let sequence = 1; sequence <= 205; sequence += 1) {
      state = reduceRuntimeEvent(
        state,
        createRuntimeEvent({
          runId: "run-1",
          sequence,
          type: "model.chunk",
          data: { text: String(sequence) },
        }),
      );
    }

    expect(state.events).toHaveLength(200);
    expect(state.events[0]?.sequence).toBe(6);
    expect(state.events.at(-1)?.sequence).toBe(205);
  });

  it("round-trips a canonical spike snapshot without timestamps, paths, or secrets", async () => {
    const projection = buildEditorProjection(VALID_WORKSPACE);
    const snapshot = createSpikeProjectSnapshot({
      projectId: "project-1",
      workspace: projection.workspace,
      program: projection.program,
      interactionManifest: projection.interactionManifest,
    });
    const host = new InMemoryHostBridge();

    await host.saveProject({ project: snapshot });
    const loaded = await host.loadProject("project-1");

    expect(loaded).toEqual(snapshot);
    expect(Object.keys(snapshot).sort()).toEqual([
      "interactionManifest",
      "program",
      "projectId",
      "schemaVersion",
      "workspace",
    ]);
    expect(JSON.stringify(snapshot)).not.toMatch(/timestamp|[A-Z]:\\\\|secret/i);
  });
});
