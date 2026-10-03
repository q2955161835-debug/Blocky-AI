import type { Json, Resource } from "@blocky/language-schema";

export function calculate(
  resource: Resource,
  input: Json,
  signal: AbortSignal,
): Json {
  signal.throwIfAborted();
  if (
    resource.scope !== "project" ||
    resource.definition.version !== "1" ||
    resource.secretBindings.length ||
    JSON.stringify(resource.definition.permissions) !== '["data.calculate"]' ||
    JSON.stringify(resource.capabilityRequirements) !== '["data.calculate"]'
  )
    throw Error("BLK-TOOL-001");
  const fail = () => {
    throw Error("BLK-CALCULATE-001");
  };
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).length !== 2
  )
    return fail();
  const { operation, values } = input;
  if (
    typeof operation !== "string" ||
    !["add", "subtract", "multiply", "divide"].includes(operation) ||
    !Array.isArray(values) ||
    values.length < 2 ||
    values.length > 100 ||
    values.some(
      (value) =>
        typeof value !== "number" ||
        !Number.isFinite(value) ||
        Math.abs(value) > 1e12,
    )
  )
    return fail();
  const operands = values as number[];
  let result = operands[0];
  for (const operand of operands.slice(1)) {
    if (operation === "add") result += operand;
    else if (operation === "subtract") result -= operand;
    else if (operation === "multiply") result *= operand;
    else {
      if (operand === 0) return fail();
      result /= operand;
    }
    if (!Number.isFinite(result) || Math.abs(result) > 1e15) return fail();
  }
  // Keep deterministic JavaScript number semantics; never claim decimal accounting precision.
  return { operation, result };
}
