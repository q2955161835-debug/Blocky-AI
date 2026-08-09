import { describe, expect, it } from "vitest";
import { SPIKE_BLOCK_IDS } from "../../src/blockly/catalog";
import { getDefinition } from "../../src/blockly/definitions";

describe("spike block catalog", () => {
  it("keeps the deliberately limited 31-block spike catalog stable", () => {
    expect(SPIKE_BLOCK_IDS).toHaveLength(31);
    expect(new Set(SPIKE_BLOCK_IDS).size).toBe(31);
  });

  it("keeps the chat entry composer separate from its block surface", () => {
    expect(getDefinition("core.interaction.chat_entry").hasInlineComposer).toBe(
      false,
    );
  });

  it("uses exact reference and boolean output types", () => {
    expect(getDefinition("core.tool.reference").outputCheck).toBe("type.tool_ref");
    expect(getDefinition("core.data.compare").outputCheck).toBe("type.boolean");
  });
});
