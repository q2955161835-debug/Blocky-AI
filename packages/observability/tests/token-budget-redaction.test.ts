import { expect, it } from "vitest";
import { redact } from "../src/redact";

it("makes decimal budget fields discoverable without unmasking token-bearing text", () => {
  expect(redact({ OUTPUT_TOKENS: "1048576" }).value).toEqual({ OUTPUT_TOKENS: "1048576" });
  expect(redact({ OUTPUT_TOKENS: "32768" }).value).toEqual({ OUTPUT_TOKENS: "32768" });
  for (const value of ["sk-synthetic-private", "Bearer synthetic", "1e6", "1000000001"]) {
    expect(redact({ OUTPUT_TOKENS: value }).value).toEqual({ OUTPUT_TOKENS: "[已脱敏]" });
  }
  expect(redact({ API_TOKEN: "1048576" }).value).toEqual({ API_TOKEN: "[已脱敏]" });
});
