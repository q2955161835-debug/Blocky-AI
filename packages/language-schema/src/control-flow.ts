import type { IrNode, Json } from "./index";

export const controlTypes = [
  "core.flow.repeat",
  "core.flow.foreach",
  "core.flow.while",
  "core.flow.try",
  "core.flow.retry",
] as const;
export function boundedField(value: unknown, min: number, max: number): number {
  if (
    typeof value !== "string" ||
    !/^\d+$/.test(value) ||
    Number(value) < min ||
    Number(value) > max
  )
    throw Error("BLK-FLOW-CONFIG");
  return Number(value);
}
export function controlBody(
  node: IrNode,
  name = "DO",
  required = true,
): IrNode | undefined {
  const body = node.inputs[name];
  if (Array.isArray(body) || (required && !body))
    throw Error("BLK-FLOW-CONFIG");
  return body ?? undefined;
}
export function validateControlNode(node: IrNode): void {
  if (!controlTypes.includes(node.blockType as (typeof controlTypes)[number]))
    return;
  const f = node.fields;
  if (node.blockType === "core.flow.try") {
    controlBody(node, "TRY");
    controlBody(node, "CATCH");
  } else controlBody(node);
  if (node.blockType === "core.flow.repeat") boundedField(f.COUNT, 0, 100);
  if (node.blockType === "core.flow.foreach") boundedField(f.MAX_ITEMS, 1, 100);
  if (node.blockType === "core.flow.while") {
    boundedField(f.MAX_ITERATIONS, 1, 100);
    if (
      !["equals", "contains", "truthy"].includes(String(f.OP)) ||
      (f.OP !== "truthy" && typeof f.VALUE !== "string")
    )
      throw Error("BLK-FLOW-CONFIG");
  }
  if (
    ["core.flow.foreach", "core.flow.while"].includes(node.blockType) &&
    !["input", "result", "memory"].includes(String(f.SOURCE))
  )
    throw Error("BLK-FLOW-CONFIG");
  if (node.blockType === "core.flow.retry") {
    boundedField(f.ATTEMPTS, 1, 3);
    boundedField(f.WAIT_MS, 0, 3000);
  }
}
const pure = new Set([
  "core.data.set",
  "core.data.transform",
  "core.logic.condition",
  "core.flow.parallel",
  "core.flow.delay",
  "core.flow.fail",
  ...controlTypes,
]);
/** Only a known read-only adapter may enter a retry body. A model loop is always excluded. */
export function assertRetrySafe(
  node: IrNode,
  readOnlyTool: (id: string) => boolean = () => false,
): void {
  const visited = new Set<IrNode>();
  const visit = (current: IrNode, depth: number): void => {
    if (
      depth > 32 ||
      visited.has(current) ||
      visited.size >= 2000 ||
      (!pure.has(current.blockType) &&
        !(
          current.blockType === "core.tool.invoke" &&
          typeof current.fields.RESOURCE === "string" &&
          readOnlyTool(current.fields.RESOURCE)
        ))
    )
      throw Error("BLK-FLOW-RETRY-UNSAFE");
    visited.add(current);
    for (const value of Object.values(current.inputs)) {
      if (Array.isArray(value)) throw Error("BLK-FLOW-RETRY-UNSAFE");
      if (value) visit(value, depth + 1);
    }
    if (current.next) visit(current.next, depth + 1);
  };
  visit(node, 0);
}
export function condition(
  value: Json,
  operator: unknown,
  expected: unknown,
): boolean {
  if (!["equals", "contains", "truthy"].includes(String(operator)))
    throw Error("BLK-FLOW-CONFIG");
  if (operator === "truthy") return Boolean(value);
  if (typeof expected !== "string") throw Error("BLK-FLOW-CONFIG");
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return operator === "equals" ? text === expected : text.includes(expected);
}
