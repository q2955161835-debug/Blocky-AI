import { expect, it } from "vitest";
import { createStartingBlueprint } from "../../block-catalog/src/starting-blueprints";
import { nativeAgentServices } from "../src/native-agent";
import { validateOutput } from "../src/output-schema";

it("executes the declared work calculator with actual numeric receipts and no native file or process call", async () => {
  const resource =
    createStartingBlueprint("work-assistant").resources["work-calculator"];
  expect(resource).toBeDefined();
  // Exercise the same closed-schema guard used before a model/tool request.
  validateOutput(
    { operation: "multiply", values: [10, 12] },
    JSON.parse(String(resource.definition.inputSchemaJson)),
  );
  let nativeCalls = 0;
  const services = nativeAgentServices(async () => {
    nativeCalls++;
    throw Error("Unexpected native capability");
  });
  const request = {
    projectId: "calculator-project",
    runId: "calculator-run",
    requestId: "calculator-request",
    resource,
  };
  const signal = new AbortController().signal;
  expect(
    await services.tool!(
      { ...request, input: { operation: "multiply", values: [10, 12] } },
      signal,
    ),
  ).toMatchObject({ result: 120 });
  expect(
    await services.tool!(
      { ...request, input: { operation: "add", values: [120, 60] } },
      signal,
    ),
  ).toMatchObject({ result: 180 });
  await expect(
    services.tool!(
      { ...request, input: { operation: "divide", values: [1, 0] } },
      signal,
    ),
  ).rejects.toThrow("BLK-CALCULATE-001");
  await expect(
    services.tool!(
      {
        ...request,
        input: { operation: "add", values: [1], code: "process.exit()" },
      },
      signal,
    ),
  ).rejects.toThrow("BLK-CALCULATE-001");
  resource.definition.permissions = ["workspace.write"];
  await expect(
    services.tool!(
      { ...request, input: { operation: "add", values: [1, 2] } },
      signal,
    ),
  ).rejects.toThrow("BLK-TOOL-001");
  expect(nativeCalls).toBe(0);
});
