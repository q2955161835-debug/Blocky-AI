import { expect, it } from "vitest";
import { createSettings, parseSettings, resetSetting, resolveSetting, updateSetting } from "../src";

it("keeps the default model reference through a settings round trip and allows clearing it", () => {
  const settings = updateSetting(createSettings("app"), "models.defaultResourceId", "saved-model");
  const reopened = parseSettings(JSON.stringify(settings));
  expect(resolveSetting("models.defaultResourceId", { app: reopened })).toEqual({ value: "saved-model", source: "app" });
  expect(resolveSetting("models.defaultResourceId", { app: resetSetting(reopened, "models.defaultResourceId") }).value).toBe("");
});

it("restricts the default model to an application resource reference", () => {
  expect(() => updateSetting(createSettings("project"), "models.defaultResourceId", "saved-model")).toThrow();
  for (const value of ["../secret", "https://example.com", "sk-do-not-store-a-key", "__proto__", "a".repeat(129), 123, null]) {
    expect(() => updateSetting(createSettings("app"), "models.defaultResourceId", value)).toThrow();
  }
  expect(updateSetting(createSettings("app"), "models.defaultResourceId", "").values).toEqual({ "models.defaultResourceId": "" });
});
