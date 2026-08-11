import { describe, expect, it } from "vitest";
import type { BlockyProgram } from "../../src/core/ir";
import { createRuntimeEvent } from "../../src/core/runtimeEvents";
import {
  indexProgramBlockTypes,
  presentRuntimeEvent,
} from "../../src/runtime/eventPresentation";

const PROGRAM: BlockyProgram = {
  schemaVersion: "blocky.ir/v0-spike",
  roots: [
    {
      id: "root-agent",
      type: "core.agent.define",
      fields: {},
      inputs: {
        MEMBERS: {
          id: "tool-call",
          type: "core.tool.call",
          fields: {},
          inputs: {},
          next: {
            id: "reply",
            type: "core.message.reply",
            fields: {},
            inputs: {},
            next: null,
          },
        },
      },
      next: null,
    },
  ],
};

describe("runtime event presentation", () => {
  it("indexes every root, input, and next node exactly by its source block ID", () => {
    expect(indexProgramBlockTypes(PROGRAM)).toEqual({
      "root-agent": "core.agent.define",
      "tool-call": "core.tool.call",
      reply: "core.message.reply",
    });
  });

  it("uses the shared block catalog colour and category name", () => {
    const event = createRuntimeEvent({
      runId: "run-1",
      sequence: 1,
      type: "tool.started",
      blockId: "tool-call",
    });

    expect(presentRuntimeEvent(event, indexProgramBlockTypes(PROGRAM))).toEqual({
      categoryId: "tools",
      categoryName: "工具",
      colour: "#ef6c00",
    });
  });

  it("falls back to a visible neutral system category without guessing from event text", () => {
    const event = createRuntimeEvent({
      runId: "run-1",
      sequence: 2,
      type: "tool.completed",
    });

    expect(presentRuntimeEvent(event, {})).toEqual({
      categoryId: "neutral",
      categoryName: "系统",
      colour: "#8f99a8",
    });
  });
});
