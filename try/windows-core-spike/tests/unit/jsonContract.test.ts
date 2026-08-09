import { describe, expect, expectTypeOf, it } from "vitest";
import type { JsonPrimitive, JsonValue } from "../../src/core/json";

describe("JSON contract", () => {
  it("exposes the shared recursive JSON value contract", () => {
    const value: JsonValue = { nested: ["value", 1, false, null] };
    expect(value).toEqual({ nested: ["value", 1, false, null] });
    expectTypeOf<JsonPrimitive>().toMatchTypeOf<string | number | boolean | null>();
  });
});
