export type JsonPrimitive = string | number | boolean | null;

export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };

function rejectSymbolKeys(value: object): void {
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new TypeError("JSON object must not contain symbol keys");
  }
}

export function canonicalizeJson(value: unknown): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("JSON number must be finite");
    return value;
  }
  if (Array.isArray(value)) {
    rejectSymbolKeys(value);
    return Array.from({ length: value.length }, (_, index) => {
      if (!(index in value)) throw new TypeError("JSON array must not contain holes");
      return canonicalizeJson(value[index]);
    });
  }
  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("JSON record must be plain");
    }
    rejectSymbolKeys(value);
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalizeJson(item)]),
    );
  }
  throw new TypeError(`Unsupported JSON value: ${typeof value}`);
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(canonicalizeJson(value));
}
