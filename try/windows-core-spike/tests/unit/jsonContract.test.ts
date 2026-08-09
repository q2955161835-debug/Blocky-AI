import { describe, expect, expectTypeOf, it } from "vitest";
import {
  canonicalizeJson,
  stableStringify,
  type JsonPrimitive,
  type JsonValue,
} from "../../src/core/json";

describe("JSON contract", () => {
  it("exposes the shared recursive JSON value contract", () => {
    const value: JsonValue = { nested: ["value", 1, false, null] };
    expect(value).toEqual({ nested: ["value", 1, false, null] });
    expectTypeOf<JsonPrimitive>().toMatchTypeOf<string | number | boolean | null>();
  });

  it("sorts object keys without changing array order", () => {
    expect(stableStringify({ z: ["first", "second"], a: { y: 2, x: 1 } }))
      .toBe('{"a":{"x":1,"y":2},"z":["first","second"]}');
  });

  it("rejects values that JSON cannot serialize", () => {
    expect(() => canonicalizeJson({ missing: undefined })).toThrow("Unsupported JSON value: undefined");
    expect(() => canonicalizeJson({ callback: () => undefined })).toThrow("Unsupported JSON value: function");
    expect(() => canonicalizeJson({ marker: Symbol("not-json") })).toThrow("Unsupported JSON value: symbol");
    expect(() => canonicalizeJson(Number.NaN)).toThrow("JSON number must be finite");
    expect(() => canonicalizeJson(Number.POSITIVE_INFINITY)).toThrow("JSON number must be finite");
  });

  it("accepts only plain JSON records without symbol keys", () => {
    class ExampleRecord {
      value = "not JSON";
    }
    const symbolKey = Symbol("not-json");

    expect(() => canonicalizeJson(new Date())).toThrow("JSON record must be plain");
    expect(() => canonicalizeJson(new Map())).toThrow("JSON record must be plain");
    expect(() => canonicalizeJson(new Set())).toThrow("JSON record must be plain");
    expect(() => canonicalizeJson(new ExampleRecord())).toThrow("JSON record must be plain");
    expect(() => canonicalizeJson({ [symbolKey]: "value" })).toThrow("JSON object must not contain symbol keys");
    expect(canonicalizeJson(Object.assign(Object.create(null), { value: "accepted" })))
      .toEqual({ value: "accepted" });
  });
});
