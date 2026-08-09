import { describe, expect, it } from "vitest";
import { createHundredBlockWorkspaceState } from "../../src/blockly/fixtures";
import { compileWorkspace } from "../../src/core/compileWorkspace";
import { stableStringify } from "../../src/core/json";

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function withReversedObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withReversedObjectKeys);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .reverse()
      .map(([key, item]) => [key, withReversedObjectKeys(item)]),
  );
}

describe("workspace compiler", () => {
  it("emits a deterministic stable IR and source map for the hundred-block fixture", () => {
    const first = compileWorkspace(createHundredBlockWorkspaceState());
    const second = compileWorkspace(createHundredBlockWorkspaceState());

    expect(first.diagnostics).toEqual([]);
    expect(stableStringify(first.program)).toBe(stableStringify(second.program));
    expect(first.sourceMap["block-001"]).toEqual({ nodeId: "block-001" });
    expect(first.program.schemaVersion).toBe("blocky.ir/v0-spike");
  });

  it("ignores visual state and JSON object key order", () => {
    const original = createHundredBlockWorkspaceState();
    const altered = cloneJson(original) as Record<string, unknown>;
    const roots = (altered.blocks as { blocks: Array<Record<string, unknown>> }).blocks;
    roots[0].x = 999;
    roots[0].y = -999;
    roots[0].collapsed = true;

    const originalProgram = compileWorkspace(original).program;
    const alteredProgram = compileWorkspace(withReversedObjectKeys(altered)).program;

    expect(stableStringify(alteredProgram)).toBe(stableStringify(originalProgram));
  });

  it("preserves next-chain command order in the IR", () => {
    const first = compileWorkspace({
      blocks: {
        blocks: [{
          id: "event",
          type: "core.event.manual_run",
          next: {
            block: {
              id: "reply",
              type: "core.message.reply",
              next: { block: { id: "send", type: "core.message.send" } },
            },
          },
        }],
      },
    });
    const reversed = compileWorkspace({
      blocks: {
        blocks: [{
          id: "event",
          type: "core.event.manual_run",
          next: {
            block: {
              id: "send",
              type: "core.message.send",
              next: { block: { id: "reply", type: "core.message.reply" } },
            },
          },
        }],
      },
    });

    expect(stableStringify(reversed.program)).not.toBe(stableStringify(first.program));
  });

  it("reports duplicate stable block IDs", () => {
    const result = compileWorkspace({
      blocks: { blocks: [
        { id: "same", type: "core.event.manual_run" },
        { id: "same", type: "core.message.send" },
      ] },
    });

    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: "IR_DUPLICATE_BLOCK_ID",
      severity: "error",
      blockId: "same",
    }));
    expect(result.program.roots).toEqual([]);
    expect(result.sourceMap).toEqual({});
  });

  it("reports a declared next connection when its parent has no next connector", () => {
    const result = compileWorkspace({
      blocks: { blocks: [{
        id: "literal",
        type: "core.data.literal",
        next: { block: { id: "send", type: "core.message.send" } },
      }] },
    });

    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: "IR_INVALID_CONNECTION",
      severity: "error",
      blockId: "literal",
    }));
  });

  it("reports block types outside the spike catalog", () => {
    const result = compileWorkspace({
      blocks: { blocks: [{ id: "unknown", type: "extension.future_block" }] },
    });

    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: "IR_UNKNOWN_BLOCK_TYPE",
      severity: "error",
      blockId: "unknown",
    }));
  });

  it("reports serialized input connections with incompatible block shapes", () => {
    const result = compileWorkspace({
      blocks: { blocks: [{
        id: "reply",
        type: "core.message.reply",
        inputs: {
          MESSAGE: { block: { id: "literal", type: "core.data.literal", fields: { VALUE: "text" } } },
        },
      }] },
    });

    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: "IR_INVALID_CONNECTION",
      severity: "error",
      blockId: "reply",
    }));
  });
});
