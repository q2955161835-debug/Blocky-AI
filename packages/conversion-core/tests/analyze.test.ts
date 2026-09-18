import { expect, it } from "vitest";
import { analyzeFile } from "../src/analyze";
import { evaluateExpression } from "@blocky/language-schema";
it("parses Python and TypeScript functions and converts a bounded numeric subset", () => {
  const py = analyzeFile(
    "math.py",
    "def scale(value: float, factor: float) -> float:\n    return value * factor + 2\n",
  );
  const ts = analyzeFile(
    "math.ts",
    "export function scale(value: number, factor: number): number { return value * factor + 2; }",
  );
  for (const result of [py, ts]) {
    expect(result.symbols[0].decision).toBe("custom-block");
    expect(result.symbols[0].parameters).toEqual(["value", "factor"]);
    for (const [value, factor] of [
      [2, 3],
      [0, 7],
      [-0.5, 4],
      [12.5, 0.2],
    ])
      expect(
        evaluateExpression(result.symbols[0].program, { value, factor }),
      ).toBe(value * factor + 2);
  }
});
it("expands a closed local function composition and identifies a blueprint", () => {
  const result = analyzeFile(
    "flow.ts",
    "function double(x: number): number { return x * 2; }\nexport function flow(x: number): number { return double(x) + 3; }",
  );
  const symbol = result.symbols.find((s) => s.name === "flow")!;
  expect(symbol.decision).toBe("blueprint");
  expect(symbol.dependencies).toEqual(["double"]);
  expect(evaluateExpression(symbol.program, { x: 4 })).toBe(11);
  expect(symbol.stages?.map((s) => s.name)).toEqual(["double", "flow"]);
  expect(
    symbol.stages?.reduce(
      (value, stage) => evaluateExpression(stage.program, value),
      4,
    ),
  ).toBe(11);
});
it("retains side effects, dynamic code, recursion, coercion and malformed syntax", () => {
  for (const source of [
    "export function run(x: number) { fetch('https://example.com'); return x; }",
    "function run(x: number) { return process.env.KEY; }",
    "function run(x: number) { return run(x); }",
    "function run(x: string) { return x + 2; }",
    "function run(x: number) { return x ? 1 : 2; }",
    "function run(x: number): string { return x + 2; }",
    "function run(",
  ]) {
    const result = analyzeFile("untrusted.ts", source);
    expect(result.symbols.every((s) => !s.program)).toBe(true);
    expect(result.convertible).toBe(0);
  }
  expect(
    analyzeFile(
      "decorated.py",
      "@replace\ndef calc(x: float) -> float:\n    return x + 1\n",
    ).convertible,
  ).toBe(0);
});
it("respects parameter shadowing instead of resolving a different top-level function", () => {
  const result = analyzeFile("shadow.ts", "function double(x: number) { return x * 2; } function run(double: number) { return double(3); }");
  expect(result.symbols.find(s => s.name === "run")?.decision).toBe("native-retained");
});
it("uses loop, state and method boundaries as a compatibility-draft signal only", () => {
  const result = analyzeFile(
    "harness.py",
    "class Runner:\n    def __init__(self):\n        self.state = {}\n    def run(self):\n        while True:\n            self.state['reply'] = self.tool()\n",
  );
  expect(result.symbols.some((s) => s.decision === "compatibility-draft")).toBe(
    true,
  );
  expect(result.convertible).toBe(0);
});
