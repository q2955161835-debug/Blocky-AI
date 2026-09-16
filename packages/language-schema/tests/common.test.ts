import { expect, it } from "vitest";
import { canonicalJson } from "../src/index";
it("rejects non JSON protocol values and circular references", () => {
  for (const value of [undefined, Infinity, new Date(), () => 0])
    expect(() => canonicalJson(value)).toThrow();
  const cyclic: unknown[] = [];
  cyclic.push(cyclic);
  expect(() => canonicalJson(cyclic)).toThrow();
});
it("sorts keys by Unicode code point instead of UTF-16 surrogate order", () => {
  expect(canonicalJson({ "𐀀": 1, "\uE000": 2 })).toBe('{"":2,"𐀀":1}');
});
