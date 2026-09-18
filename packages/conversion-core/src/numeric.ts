import {
  parseExpressionProgram,
  type NumericExpression,
  type ExpressionProgram,
} from "@blocky/language-schema";
import {
  children,
  descendants,
  functionName,
  textAt,
  type SyntaxNode,
} from "./syntax";
export type NumericStage = { name: string; program: ExpressionProgram };
/** Lower only closed pure arithmetic. Unsupported syntax is retained, never evaluated. */
export function lowerNumeric(
  code: string,
  node: SyntaxNode,
  functions: Map<string, SyntaxNode>,
): {
  program: ExpressionProgram;
  dependencies: string[];
  stages?: NumericStage[];
} {
  const dependencies = new Set<string>();
  let budget = 0;
  let intercepted: SyntaxNode | undefined;
  const fail = (): never => {
    throw Error("unsupported-numeric-subset");
  };
  const parameters = (fn: SyntaxNode) => {
    if (children(fn).some((n) => ["async", "*"].includes(n.name)))
      return fail();
    for (const annotation of children(fn).filter((n) =>
      ["TypeAnnotation", "TypeDef"].includes(n.name),
    ))
      if (!/^(?::|->)\s*(number|float|int)$/.test(textAt(code, annotation)))
        return fail();
    const list = fn.getChild("ParamList");
    if (!list) return fail();
    const items = children(list),
      names: string[] = [];
    for (const item of items) {
      if (["(", ")", ","].includes(item.name)) continue;
      if (["TypeAnnotation", "TypeDef"].includes(item.name)) {
        if (!/^:\s*(number|float|int)$/.test(textAt(code, item))) return fail();
      } else if (["VariableDefinition", "VariableName"].includes(item.name))
        names.push(textAt(code, item));
      else return fail();
    }
    if (
      new Set(names).size !== names.length ||
      names.includes("self") ||
      names.length > 16
    )
      return fail();
    return names;
  };
  const body = (fn: SyntaxNode) => {
    const block = fn.getChild("Block") ?? fn.getChild("Body");
    if (!block) return fail();
    const statements = children(block).filter(
      (n) => !["{", "}", ":", "Comment"].includes(n.name),
    );
    if (statements.length !== 1 || statements[0].name !== "ReturnStatement")
      return fail();
    const expressions = children(statements[0]).filter(
      (n) => !["return", ";", "Comment"].includes(n.name),
    );
    if (expressions.length !== 1) return fail();
    return expressions[0];
  };
  const parse = (
    part: SyntaxNode,
    environment: Map<string, NumericExpression>,
    visited: Set<SyntaxNode>,
    depth: number,
  ): NumericExpression => {
    if (++budget > 256 || depth > 24) return fail();
    if (intercepted?.from === part.from && intercepted.to === part.to)
      return { parameter: "value" };
    const text = textAt(code, part),
      items = children(part);
    if (part.name === "Number" && /^\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(text))
      return { number: Number(text) };
    if (part.name === "VariableName" && environment.has(text))
      return structuredClone(environment.get(text)!);
    if (part.name === "ParenthesizedExpression") {
      const contents = items.filter((n) => !["(", ")"].includes(n.name));
      if (contents.length === 1)
        return parse(contents[0], environment, visited, depth + 1);
    }
    if (
      part.name === "UnaryExpression" &&
      items.length === 2 &&
      ["+", "-"].includes(textAt(code, items[0]))
    )
      return {
        op: textAt(code, items[0]) as "+" | "-",
        left: { number: 0 },
        right: parse(items[1], environment, visited, depth + 1),
      };
    if (
      part.name === "BinaryExpression" &&
      items.length === 3 &&
      ["+", "-", "*", "/"].includes(textAt(code, items[1]))
    )
      return {
        op: textAt(code, items[1]) as "+" | "-" | "*" | "/",
        left: parse(items[0], environment, visited, depth + 1),
        right: parse(items[2], environment, visited, depth + 1),
      };
    if (
      part.name === "CallExpression" &&
      items.length === 2 &&
      items[0].name === "VariableName" &&
      items[1].name === "ArgList"
    ) {
      const name = textAt(code, items[0]),
        fn = functions.get(name);
      if (environment.has(name) || !fn || visited.has(fn) || visited.size >= 8) return fail();
      const args = children(items[1]).filter(
          (n) => !["(", ")", ","].includes(n.name),
        ),
        params = parameters(fn);
      if (params.length !== args.length) return fail();
      const values = args.map((arg) =>
        parse(arg, environment, visited, depth + 1),
      );
      dependencies.add(name);
      return parse(
        body(fn),
        new Map(params.map((p, i) => [p, values[i]])),
        new Set([...visited, fn]),
        depth + 1,
      );
    }
    return fail();
  };
  const names = parameters(node);
  const expression = parse(
    body(node),
    new Map(names.map((p) => [p, { parameter: p }])),
    new Set([node]),
    0,
  );
  const program = parseExpressionProgram({
    schemaVersion: "blocky.expression/v1",
    parameters: names,
    expression,
  });
  const split = (fn: SyntaxNode, seen: Set<SyntaxNode>): NumericStage[] => {
    if (seen.has(fn) || seen.size >= 8) return fail();
    const params = parameters(fn),
      returned = body(fn);
    if (params.length !== 1) return fail();
    const nodes = descendants(returned),
      calls = nodes.filter((n) => n.name === "CallExpression");
    if (!calls.length) {
      budget = 0;
      return [
        {
          name: functionName(code, fn),
          program: parseExpressionProgram({
            schemaVersion: "blocky.expression/v1",
            parameters: params,
            expression: parse(
              returned,
              new Map([[params[0], { parameter: params[0] }]]),
              new Set([fn]),
              0,
            ),
          }),
        },
      ];
    }
    if (calls.length !== 1) return fail();
    const call = calls[0],
      parts = children(call),
      callee = functions.get(textAt(code, parts[0]));
    const args = children(parts[1]).filter(
      (n) => !["(", ")", ","].includes(n.name),
    );
    if (
      !callee ||
      parameters(callee).length !== 1 ||
      args.length !== 1 ||
      args[0].name !== "VariableName" ||
      textAt(code, args[0]) !== params[0] ||
      nodes.some(
        (n) =>
          n.name === "VariableName" &&
          textAt(code, n) === params[0] &&
          (n.from < call.from || n.to > call.to),
      )
    )
      return fail();
    const stages = split(callee, new Set([...seen, fn]));
    intercepted = call;
    budget = 0;
    try {
      stages.push({
        name: functionName(code, fn),
        program: parseExpressionProgram({
          schemaVersion: "blocky.expression/v1",
          parameters: ["value"],
          expression: parse(returned, new Map(), new Set([fn]), 0),
        }),
      });
    } finally {
      intercepted = undefined;
    }
    return stages;
  };
  let stages: NumericStage[] | undefined;
  try {
    stages = split(node, new Set());
  } catch {
    /* Nonlinear pure calls remain one custom block. */
  }
  return {
    program,
    stages,
    dependencies: [...dependencies].sort(),
  };
}
