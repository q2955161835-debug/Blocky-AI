/** Canonical adapter keys preserve legacy projects while resolving typed references. */
export function implementationKey(value: unknown): string {
  if (typeof value === "string") return value;
  if (
    value &&
    typeof value === "object" &&
    "kind" in value &&
    "id" in value &&
    ["adapter", "package", "task"].includes(String(value.kind)) &&
    typeof value.id === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(value.id)
  )
    return `${value.kind}://${value.id}`;
  throw Error("BLK-RESOURCE-001");
}
