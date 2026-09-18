import { expect, it } from "vitest";
import { evaluateExpression, parseExpressionProgram } from "../src/expression";
const program = {
  schemaVersion: "blocky.expression/v1",
  parameters: ["value", "factor"],
  expression: {
    op: "+",
    left: {
      op: "*",
      left: { parameter: "value" },
      right: { parameter: "factor" },
    },
    right: { number: 2 },
  },
};
it("evaluates the constrained numeric contract without code execution", () => {
  expect(evaluateExpression(program, { value: 3, factor: 4 })).toBe(14);
  expect(evaluateExpression(program, { value: -0.5, factor: 4 })).toBe(0);
  expect(() => evaluateExpression(program, { value: "3", factor: 4 })).toThrow(
    "BLK-EXPR-002",
  );
  expect(() =>
    evaluateExpression(program, { value: Infinity, factor: 4 }),
  ).toThrow();
  expect(() =>
    evaluateExpression(program, { value: 1e9, factor: 1e9 }),
  ).toThrow();
});
it("rejects unknown instructions, undeclared parameters, cycles and excess depth", () => {
  expect(() =>
    parseExpressionProgram({
      ...program,
      expression: { call: "eval", text: "process.exit()" },
    }),
  ).toThrow("BLK-EXPR-001");
  expect(() =>
    parseExpressionProgram({ ...program, expression: { parameter: "other" } }),
  ).toThrow();
  const cycle: Record<string, unknown> = { op: "+", right: { number: 1 } };
  cycle.left = cycle;
  expect(() =>
    parseExpressionProgram({ ...program, expression: cycle }),
  ).toThrow();
  const division = {
    ...program,
    expression: { op: "/", left: { number: 2 }, right: { number: 0 } },
  };
  expect(() => evaluateExpression(division, { value: 0, factor: 0 })).toThrow(
    "BLK-EXPR-002",
  );
});
