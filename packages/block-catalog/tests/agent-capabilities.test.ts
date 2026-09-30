import { expect, it } from "vitest";
import { getBlock } from "../src/catalog";

it("publishes bounded control and tool-loop blocks with resource and slot metadata", () => {
  expect(getBlock("core.reason.tool_loop")).toMatchObject({
    fields: ["RESOURCE", "MAX_TURNS", "OUTPUT_TOKENS"],
    inputs: ["TOOLS"],
    requiredInputs: ["TOOLS"],
    inputChecks: { TOOLS: "agent-tool" },
    resourceFields: { RESOURCE: "model" },
    defaultFields: { MAX_TURNS: "4", OUTPUT_TOKENS: "512" },
  });
  expect(getBlock("core.tool.expose")).toMatchObject({
    statement: true,
    statementCheck: "agent-tool",
    fields: ["RESOURCE"],
    resourceFields: { RESOURCE: "tool" },
  });
  expect(getBlock("core.flow.repeat")).toMatchObject({
    fields: ["COUNT"],
    requiredInputs: ["DO"],
    defaultFields: { COUNT: "1" },
  });
  expect(getBlock("core.flow.foreach")).toMatchObject({
    fieldOptions: { SOURCE: ["input", "result", "memory"] },
    requiredInputs: ["DO"],
  });
  expect(getBlock("core.flow.while")).toMatchObject({
    fieldOptions: {
      SOURCE: ["input", "result", "memory"],
      OP: ["equals", "contains", "truthy"],
    },
    optionalFields: ["VALUE"],
    requiredInputs: ["DO"],
  });
  expect(getBlock("core.flow.try")).toMatchObject({
    inputs: ["TRY", "CATCH"],
    requiredInputs: ["TRY", "CATCH"],
  });
  expect(getBlock("core.flow.retry")).toMatchObject({
    fields: ["ATTEMPTS", "WAIT_MS"],
    requiredInputs: ["DO"],
  });
});

it("declares the existing resource field kinds through catalog metadata", () => {
  expect(getBlock("core.knowledge.retrieve")?.resourceFields).toEqual({
    RESOURCE: "knowledge",
  });
  expect(getBlock("core.model.compose")?.resourceFields).toEqual({
    RESOURCE: "model",
  });
  expect(getBlock("core.tool.invoke")?.resourceFields).toEqual({
    RESOURCE: "tool",
  });
});
