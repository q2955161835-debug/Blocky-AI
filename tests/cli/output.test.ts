import { expect, it } from "vitest";
import { redact } from "../../packages/observability/src";
import { output } from "../../tools/blocky-cli/src/output";

it("preserves the same bounded numeric token counters in event and CLI transport", () => {
  for (const key of ["inputTokens", "outputTokens", "totalTokens", "reservedOutputTokens", "maxOutputTokens", "maxOutputTokensPerTurn"]) {
    for (const value of [0, 20, 10_000_000]) {
      const payload = { budget: { [key]: value } };
      expect(redact(payload)).toMatchObject({ value: payload, redaction: { applied: false } });
      expect(JSON.parse(output(payload))).toEqual(payload);
    }
    for (const value of ["SYNTHETIC_SECRET", null, true, -1, 1.5, 10_000_001, Number.MAX_SAFE_INTEGER + 1, Infinity, { value: 1 }]) {
      const payload = { budget: { [key]: value } };
      expect(redact(payload)).toMatchObject({ value: { budget: { [key]: "[已脱敏]" } }, redaction: { applied: true } });
      expect(JSON.parse(output(payload))).toEqual({ budget: { [key]: "[已脱敏]" } });
    }
  }
  const unknown = { token: 123, accessToken: 123, inputTokensExtra: 123 };
  const expected = { token: "[已脱敏]", accessToken: "[已脱敏]", inputTokensExtra: "[已脱敏]" };
  expect(redact(unknown).value).toEqual(expected);
  expect(JSON.parse(output(unknown))).toEqual(expected);
});
