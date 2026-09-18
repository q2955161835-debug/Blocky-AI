import type { SyntaxNode } from "@lezer/common";
export type { SyntaxNode };
export const children = (node: SyntaxNode) => {
  const out: SyntaxNode[] = [];
  for (let child = node.firstChild; child; child = child.nextSibling)
    out.push(child);
  return out;
};
export function descendants(node: SyntaxNode, limit = 50000) {
  const out: SyntaxNode[] = [],
    stack = [node];
  while (stack.length) {
    if (out.length >= limit) throw Error("BLK-CONVERT-BUDGET");
    const next = stack.pop()!;
    out.push(next);
    stack.push(...children(next).reverse());
  }
  return out;
}
export const textAt = (code: string, node: SyntaxNode) =>
  code.slice(node.from, node.to);
export const functionName = (code: string, node: SyntaxNode) => {
  const name = children(node).find((n) =>
    ["VariableDefinition", "VariableName"].includes(n.name),
  );
  return name ? textAt(code, name) : "";
};
