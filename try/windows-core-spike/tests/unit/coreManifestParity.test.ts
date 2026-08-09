import { describe, expect, it } from "vitest";
import { SPIKE_BLOCK_IDS } from "../../src/blockly/catalog";
import { getDefinition } from "../../src/blockly/definitions";
import { SPIKE_BLOCK_SPECS, type ConnectionShape } from "../../src/core/ir";

function connection(value: unknown): ConnectionShape | undefined {
  return typeof value === "string" ? value as ConnectionShape : undefined;
}

function inputConnections(definition: ReturnType<typeof getDefinition>): Record<string, ConnectionShape> {
  const args = definition.json.args0 as Array<Record<string, unknown>> | undefined;
  return Object.fromEntries((args ?? [])
    .filter((argument) => argument.type === "input_value" || argument.type === "input_statement")
    .flatMap((argument) => {
      const name = argument.name;
      const check = connection(argument.check);
      return typeof name === "string" && check ? [[name, check]] : [];
    }));
}

describe("core semantic manifest parity", () => {
  it("covers the fixed 31-ID catalog and each UI connector shape", () => {
    expect(Object.keys(SPIKE_BLOCK_SPECS).sort()).toEqual([...SPIKE_BLOCK_IDS].sort());

    for (const id of SPIKE_BLOCK_IDS) {
      const definition = getDefinition(id);
      const spec = SPIKE_BLOCK_SPECS[id];

      expect(spec).toEqual({
        ...(connection(definition.json.previousStatement) ? { previous: connection(definition.json.previousStatement) } : {}),
        ...(connection(definition.json.nextStatement) ? { next: connection(definition.json.nextStatement) } : {}),
        ...(connection(definition.outputCheck) ? { output: connection(definition.outputCheck) } : {}),
        ...(Object.keys(inputConnections(definition)).length > 0 ? { inputs: inputConnections(definition) } : {}),
      });
    }
  });
});
