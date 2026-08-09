import { describe, expect, it } from "vitest";
import { CONNECTION_GRAMMARS } from "../../src/blockly/connectionGrammar";
import { getDefinition } from "../../src/blockly/definitions";

describe("spike connection grammar", () => {
  it("uses only the six documented grammar categories", () => {
    expect(CONNECTION_GRAMMARS).toEqual([
      "event-hat",
      "command",
      "typed-value",
      "boolean-condition",
      "statement-container",
      "reference",
    ]);
  });

  it("keeps chat capabilities and handler sockets distinct", () => {
    const entry = getDefinition("core.interaction.chat_entry");
    expect(entry.statementInputs).toEqual([
      { name: "CAPABILITIES", check: "slot.entry_capability" },
      { name: "HANDLER", check: "slot.command" },
    ]);
  });
});
