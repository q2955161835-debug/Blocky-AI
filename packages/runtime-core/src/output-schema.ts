import { canonicalJson, type Json } from "@blocky/language-schema";
function fail(): never {
  throw Error("BLK-OUTPUT-001");
}
const record = (v: unknown): v is Record<string, Json> =>
  v !== null && typeof v === "object" && !Array.isArray(v);
function checkSchema(schema: Json, depth = 0, counter = { n: 0 }): void {
  if (depth > 16 || ++counter.n > 1000 || !record(schema)) fail();
  const kind = schema.type;
  if (
    ![
      "object",
      "array",
      "string",
      "number",
      "integer",
      "boolean",
      "null",
    ].includes(String(kind))
  )
    fail();
  const allowed = [
    "type",
    "title",
    "description",
    "enum",
    ...(kind === "object"
      ? ["properties", "required", "additionalProperties"]
      : kind === "array"
        ? ["items", "maxItems"]
        : kind === "string"
          ? ["maxLength"]
          : ["number", "integer"].includes(String(kind))
            ? ["minimum", "maximum"]
            : []),
  ];
  if (Object.keys(schema).some((k) => !allowed.includes(k))) fail();
  for (const k of ["title", "description"])
    if (schema[k] !== undefined && typeof schema[k] !== "string") fail();
  if (
    schema.enum !== undefined &&
    (!Array.isArray(schema.enum) ||
      !schema.enum.length ||
      schema.enum.length > 1000)
  )
    fail();
  for (const k of ["maxLength", "maxItems"])
    if (
      schema[k] !== undefined &&
      (typeof schema[k] !== "number" ||
        !Number.isSafeInteger(schema[k]) ||
        schema[k] < 0)
    )
      fail();
  for (const k of ["minimum", "maximum"])
    if (
      schema[k] !== undefined &&
      (typeof schema[k] !== "number" || !Number.isFinite(schema[k]))
    )
      fail();
  if (kind === "array") {
    if (schema.items === undefined) fail();
    checkSchema(schema.items, depth + 1, counter);
  }
  if (kind === "object") {
    if (schema.properties !== undefined && !record(schema.properties)) fail();
    if (
      schema.required !== undefined &&
      (!Array.isArray(schema.required) ||
        schema.required.some((k) => typeof k !== "string"))
    )
      fail();
    if (
      schema.additionalProperties !== undefined &&
      typeof schema.additionalProperties !== "boolean"
    )
      fail();
    for (const child of Object.values(
      (schema.properties ?? {}) as Record<string, Json>,
    ))
      checkSchema(child, depth + 1, counter);
  }
}
/** Deliberately closed JSON Schema subset. Unknown assertions are errors, never ignored. */
export function validateOutput(value: Json, schema: Json, depth = 0): void {
  if (depth === 0) checkSchema(schema);
  if (depth > 16 || !record(schema)) fail();
  if (
    Object.keys(schema).some(
      (k) =>
        ![
          "type",
          "properties",
          "required",
          "additionalProperties",
          "items",
          "enum",
          "minimum",
          "maximum",
          "maxLength",
          "maxItems",
          "description",
          "title",
        ].includes(k),
    )
  )
    fail();
  const kind = schema.type;
  if (
    ![
      "object",
      "array",
      "string",
      "number",
      "integer",
      "boolean",
      "null",
    ].includes(String(kind))
  )
    fail();
  if (
    schema.enum !== undefined &&
    (!Array.isArray(schema.enum) ||
      !schema.enum.some((x) => canonicalJson(x) === canonicalJson(value)))
  )
    fail();
  if (kind === "object") {
    if (
      !record(value) ||
      (schema.properties !== undefined && !record(schema.properties))
    )
      fail();
    const properties = (schema.properties ?? {}) as Record<string, Json>;
    if (
      schema.required !== undefined &&
      (!Array.isArray(schema.required) ||
        schema.required.some(
          (k) => typeof k !== "string" || !Object.hasOwn(value, k),
        ))
    )
      fail();
    if (
      schema.additionalProperties !== undefined &&
      typeof schema.additionalProperties !== "boolean"
    )
      fail();
    for (const [key, child] of Object.entries(value)) {
      if (Object.hasOwn(properties, key))
        validateOutput(child, properties[key], depth + 1);
      else if (schema.additionalProperties === false) fail();
    }
  } else if (kind === "array") {
    if (!Array.isArray(value) || schema.items === undefined) fail();
    if (
      schema.maxItems !== undefined &&
      (typeof schema.maxItems !== "number" || value.length > schema.maxItems)
    )
      fail();
    for (const child of value) validateOutput(child, schema.items, depth + 1);
  } else if (kind === "null") {
    if (value !== null) fail();
  } else if (kind === "integer" || kind === "number") {
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      (kind === "integer" && !Number.isInteger(value))
    )
      fail();
    if (
      schema.minimum !== undefined &&
      (typeof schema.minimum !== "number" || value < schema.minimum)
    )
      fail();
    if (
      schema.maximum !== undefined &&
      (typeof schema.maximum !== "number" || value > schema.maximum)
    )
      fail();
  } else {
    if (typeof value !== kind) fail();
    if (
      kind === "string" &&
      schema.maxLength !== undefined &&
      (typeof schema.maxLength !== "number" ||
        [...String(value)].length > schema.maxLength)
    )
      fail();
  }
}
