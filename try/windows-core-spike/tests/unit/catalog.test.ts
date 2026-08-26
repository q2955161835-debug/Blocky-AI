import { describe, expect, it } from "vitest";
import { SPIKE_BLOCK_IDS } from "../../src/blockly/catalog";
import { getDefinition } from "../../src/blockly/definitions";
import {
  getSpikeBlockCategory,
  getSpikeBlockColour,
  SPIKE_BLOCK_CATEGORIES,
} from "../../src/blockly/toolbox";

describe("spike block catalog", () => {
  it("keeps the deliberately limited 38-block spike catalog stable", () => {
    expect(SPIKE_BLOCK_IDS).toHaveLength(38);
    expect(new Set(SPIKE_BLOCK_IDS).size).toBe(38);
    expect(SPIKE_BLOCK_IDS).toEqual(expect.arrayContaining([
      "core.reason.plan",
      "core.knowledge.retrieve",
      "core.knowledge.rerank",
      "core.model.call",
      "core.guardrail.check_output",
      "core.knowledge.cite",
      "core.output.markdown",
    ]));
  });

  it("uses one typed category source for all 38 blocks", () => {
    expect(SPIKE_BLOCK_CATEGORIES.map((category) => category.name)).toEqual([
      "AI 伙伴",
      "交互入口",
      "消息",
      "工具",
      "推理",
      "知识库",
      "模型",
      "护栏",
      "输出",
      "数据",
      "流程",
    ]);

    const categoryBlockIds = SPIKE_BLOCK_CATEGORIES.flatMap(
      (category) => category.blockIds,
    );
    expect(new Set(categoryBlockIds).size).toBe(38);
    expect([...categoryBlockIds].sort()).toEqual([...SPIKE_BLOCK_IDS].sort());
    expect(getSpikeBlockCategory("core.tool.call")?.id).toBe("tools");
    expect(getSpikeBlockColour("core.tool.call")).toBe("#ef6c00");
    expect(getSpikeBlockCategory("missing.block")).toBeUndefined();
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

  it("uses simplified Chinese for visible Blockly labels", () => {
    const definitions = SPIKE_BLOCK_IDS.map(getDefinition);
    const visibleMessages = definitions.flatMap((definition) =>
      Object.entries(definition.json)
        .filter(([key]) => /^message\d+$/.test(key))
        .map(([, value]) => value),
    );
    const visibleFieldTexts = definitions.flatMap((definition) =>
      Object.entries(definition.json)
        .filter(([key]) => /^args\d+$/.test(key))
        .flatMap(([, value]) => (Array.isArray(value) ? value : []))
        .filter(
          (argument): argument is { type: string; name?: string; text?: string } =>
            typeof argument === "object" && argument !== null && "type" in argument,
        )
        .filter((argument) => argument.type === "field_input" && argument.name !== "TOOL_ID")
        .map((argument) => argument.text),
    );

    expect([...visibleMessages, ...visibleFieldTexts]).not.toContainEqual(
      expect.stringMatching(/[A-Za-z]/),
    );
  });
});
