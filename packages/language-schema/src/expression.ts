/** A finite numeric expression language. No source code, calls, properties or I/O. */
export type NumericExpression =
  | { number: number }
  | { parameter: string }
  | {
      op: "+" | "-" | "*" | "/";
      left: NumericExpression;
      right: NumericExpression;
    };
export type ExpressionProgram = {
  schemaVersion: "blocky.expression/v1";
  parameters: string[];
  expression: NumericExpression;
};
const bounded = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= 1e9;
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const keys = (value: Record<string, unknown>, expected: string[]) =>
  Object.keys(value).length === expected.length &&
  expected.every((key) => Object.hasOwn(value, key));
export function parseExpressionProgram(value: unknown): ExpressionProgram {
  const fail = (): never => {
    throw Error("BLK-EXPR-001");
  };
  if (
    !object(value) ||
    !keys(value, ["schemaVersion", "parameters", "expression"]) ||
    value.schemaVersion !== "blocky.expression/v1" ||
    !Array.isArray(value.parameters) ||
    value.parameters.length > 16 ||
    value.parameters.some(
      (p) =>
        typeof p !== "string" ||
        !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(p) ||
        ["constructor", "prototype", "__proto__"].includes(p),
    )
  )
    return fail();
  const parameters = value.parameters as string[];
  if (new Set(parameters).size !== parameters.length) return fail();
  let count = 0;
  const seen = new Set<object>();
  const parse = (node: unknown, depth: number): NumericExpression => {
    if (!object(node) || seen.has(node) || ++count > 256 || depth > 32)
      return fail();
    seen.add(node);
    if (keys(node, ["number"]) && bounded(node.number))
      return { number: node.number };
    if (
      keys(node, ["parameter"]) &&
      typeof node.parameter === "string" &&
      parameters.includes(node.parameter)
    )
      return { parameter: node.parameter };
    if (
      keys(node, ["op", "left", "right"]) &&
      ["+", "-", "*", "/"].includes(String(node.op))
    )
      return {
        op: node.op as "+" | "-" | "*" | "/",
        left: parse(node.left, depth + 1),
        right: parse(node.right, depth + 1),
      };
    return fail();
  };
  return {
    schemaVersion: "blocky.expression/v1",
    parameters: [...parameters],
    expression: parse(value.expression, 0),
  };
}
export function evaluateExpression(value: unknown, input: unknown): number {
  const program = parseExpressionProgram(value);
  if (bounded(input) && program.parameters.length === 1)
    input = { [program.parameters[0]]: input };
  if (
    !object(input) ||
    !keys(input, program.parameters) ||
    program.parameters.some((key) => !bounded(input[key]))
  )
    throw Error("BLK-EXPR-002");
  const compute = (node: NumericExpression): number => {
    if ("number" in node) return node.number;
    if ("parameter" in node) return input[node.parameter] as number;
    const a = compute(node.left),
      b = compute(node.right);
    const result =
      node.op === "+"
        ? a + b
        : node.op === "-"
          ? a - b
          : node.op === "*"
            ? a * b
            : a / b;
    if (!bounded(result) || (node.op === "/" && b === 0))
      throw Error("BLK-EXPR-002");
    return result;
  };
  return compute(program.expression);
}
