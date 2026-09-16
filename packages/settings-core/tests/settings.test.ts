import { describe, expect, it } from "vitest";
import {
  createSettings,
  migratePreferences,
  parseSettings,
  resetSetting,
  resolveSetting,
  searchSettings,
  settingDefinitions,
  SettingsError,
  updateSetting,
} from "../src/index";

describe("settings documents", () => {
  it("round trips explicit values while absent values inherit defaults", () => {
    const app = updateSetting(createSettings("app"), "ui.view", "beginner");
    expect(parseSettings(JSON.stringify(app))).toEqual(app);
    expect(resolveSetting("ui.view", { app })).toEqual({
      value: "beginner",
      source: "app",
    });
    expect(resolveSetting("ui.reduceMotion", { app })).toEqual({
      value: false,
      source: "default",
    });
  });
  it("project overrides app and reset restores inheritance without modifying either input", () => {
    const app = updateSetting(
      createSettings("app"),
      "terminal.outputBudgetBytes",
      2048,
    );
    const project = updateSetting(
      createSettings("project"),
      "terminal.outputBudgetBytes",
      4096,
    );
    expect(
      resolveSetting("terminal.outputBudgetBytes", {
        app,
        project,
        resource: createSettings("resource"),
        block: createSettings("block"),
      }),
    ).toEqual({ value: 4096, source: "project" });
    const reset = resetSetting(project, "terminal.outputBudgetBytes");
    expect(
      resolveSetting("terminal.outputBudgetBytes", { app, project: reset }),
    ).toEqual({ value: 2048, source: "app" });
    expect(project.values["terminal.outputBudgetBytes"]).toBe(4096);
    expect(
      resolveSetting("ui.view", {
        app: resetSetting(updateSetting(app, "ui.view", "beginner"), "ui.view"),
      }),
    ).toEqual({ value: "professional", source: "default" });
  });
  it.each([
    "ui.reduceMotion",
    "ui.view",
    "window.minimizeToTray",
    "logs.retentionDays",
    "logs.maxStoredBytes",
  ])("prevents project overrides of local preference %s", (id) => {
    expect(() => updateSetting(createSettings("project"), id, true)).toThrow(
      SettingsError,
    );
  });
  it.each(["resource", "block"] as const)(
    "does not give %s access to user terminal settings",
    (scope) => {
      expect(() =>
        updateSetting(
          createSettings(scope),
          "terminal.outputBudgetBytes",
          2048,
        ),
      ).toThrow(SettingsError);
    },
  );
  it("rejects a document assigned to the wrong layer", () => {
    expect(() =>
      resolveSetting("ui.view", { app: createSettings("project") }),
    ).toThrow(SettingsError);
  });
  it.each([
    null,
    [],
    {},
    "{",
    { schemaVersion: "blocky.settings/v2", scope: "app", values: {} },
    {
      schemaVersion: "blocky.settings/v1",
      scope: "app",
      values: {},
      unexpected: true,
    },
    { schemaVersion: "blocky.settings/v1", scope: "other", values: {} },
  ])("rejects malformed or unsupported settings %#", (input) => {
    expect(() => parseSettings(input)).toThrow(SettingsError);
  });
  it("returns useful version diagnostics without retaining supplied values", () => {
    try {
      parseSettings({
        schemaVersion: "private-version-text",
        scope: "app",
        values: {},
      });
    } catch (error) {
      expect(error).toBeInstanceOf(SettingsError);
      expect((error as SettingsError).diagnostics[0].code).toBe(
        "BLK-SET-VERSION",
      );
      expect(JSON.stringify(error)).not.toContain("private-version-text");
      return;
    }
    throw Error("expected rejection");
  });
  it.each(["apiKey", "provider.baseUrl", "__proto__", "constructor"])(
    "rejects unknown setting %s without including its contents",
    (id) => {
      expect(() =>
        parseSettings({
          schemaVersion: "blocky.settings/v1",
          scope: "app",
          values: { [id]: "private-content" },
        }),
      ).toThrow(SettingsError);
      expect(() =>
        updateSetting(createSettings("app"), id, "private-content"),
      ).toThrow(SettingsError);
      expect(() => resetSetting(createSettings("app"), id)).toThrow(
        SettingsError,
      );
      expect(() => resolveSetting(id, {})).toThrow(SettingsError);
    },
  );
  it.each([
    "http://internal.invalid/path",
    "secret-content",
    true,
    null,
    1.5,
    NaN,
    Infinity,
    -1,
    0,
    255,
    16777217,
  ])("rejects invalid terminal budget %#", (value) => {
    expect(() =>
      updateSetting(createSettings("app"), "terminal.outputBudgetBytes", value),
    ).toThrow(SettingsError);
  });
  it.each([256, 65536, 16777216])("accepts terminal budget %s", (value) => {
    expect(
      updateSetting(createSettings("app"), "terminal.outputBudgetBytes", value)
        .values["terminal.outputBudgetBytes"],
    ).toBe(value);
  });
  it("enforces boolean, enum, log retention and log storage bounds", () => {
    for (const [id, value] of [
      ["ui.reduceMotion", "true"],
      ["ui.view", "private-content"],
      ["window.minimizeToTray", 1],
      ["logs.retentionDays", -1],
      ["logs.retentionDays", 366],
      ["logs.maxStoredBytes", 1023],
      ["logs.maxStoredBytes", 1073741825],
    ] as const) {
      expect(() => updateSetting(createSettings("app"), id, value)).toThrow(
        SettingsError,
      );
    }
    for (const [id, value] of [
      ["logs.retentionDays", 0],
      ["logs.retentionDays", 365],
      ["logs.maxStoredBytes", 1024],
      ["logs.maxStoredBytes", 1073741824],
    ] as const) {
      expect(updateSetting(createSettings("app"), id, value).values[id]).toBe(
        value,
      );
    }
  });
  it("finds settings by Chinese text and case insensitive technical terms", () => {
    expect(searchSettings("减少").map((item) => item.id)).toEqual([
      "ui.reduceMotion",
    ]);
    expect(searchSettings("  TERMINAL output ").map((item) => item.id)).toEqual(
      ["terminal.outputBudgetBytes"],
    );
    expect(searchSettings("不存在的功能")).toEqual([]);
    expect(JSON.parse(JSON.stringify(settingDefinitions))).toEqual(
      settingDefinitions,
    );
  });
  it("migrates old blocky.preferences explicitly and leaves missing properties inherited", () => {
    const migrated = migratePreferences(
      '{"reduceMotion":true,"view":"beginner","minimizeToTray":false}',
    );
    expect(migrated).toEqual({
      schemaVersion: "blocky.settings/v1",
      scope: "app",
      values: {
        "ui.reduceMotion": true,
        "ui.view": "beginner",
        "window.minimizeToTray": false,
      },
    });
    expect(migratePreferences({})).toEqual(createSettings("app"));
    expect(migratePreferences({ view: "professional" }).values).toEqual({
      "ui.view": "professional",
    });
  });
  it.each([
    null,
    "{",
    [],
    { view: "invalid" },
    { reduceMotion: 1 },
    { minimizeToTray: "false" },
    { token: "private-content" },
    { schemaVersion: "blocky.preferences/v2" },
  ])(
    "rejects damaged legacy preferences without silently losing values %#",
    (input) => {
      expect(() => migratePreferences(input)).toThrow(SettingsError);
    },
  );
});
