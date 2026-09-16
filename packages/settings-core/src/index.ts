import {
  settingDefinitions,
  type SettingDefinition,
  type SettingId,
  type SettingScope,
  type SettingValue,
  type SettingValues,
} from "./definitions";
export * from "./definitions";

export type SettingsDocument = {
  schemaVersion: "blocky.settings/v1";
  scope: SettingScope;
  values: Partial<SettingValues>;
};
export type SettingsLayers = Partial<Record<SettingScope, SettingsDocument>>;
export type SettingDiagnostic = {
  code: string;
  severity: "error";
  /** Empty for document-level or unrecognized fields; never echoes unknown input. */
  settingId: SettingId | "";
  message: string;
};
export class SettingsError extends Error {
  constructor(public readonly diagnostics: readonly SettingDiagnostic[]) {
    super(
      diagnostics
        .map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`)
        .join("; "),
    );
    this.name = "SettingsError";
  }
}
function fail(
  code: string,
  message: string,
  settingId: SettingId | "" = "",
): never {
  throw new SettingsError([{ code, severity: "error", settingId, message }]);
}
const scopes: readonly SettingScope[] = ["app", "project", "resource", "block"];
function scopeOf(input: unknown): SettingScope {
  if (typeof input !== "string" || !scopes.includes(input as SettingScope))
    return fail("BLK-SET-SCOPE", "设置作用域无效");
  return input as SettingScope;
}
function record(input: unknown): Record<string, unknown> {
  if (input === null || typeof input !== "object" || Array.isArray(input))
    return fail("BLK-SET-DOCUMENT", "设置必须是对象");
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null)
    return fail("BLK-SET-DOCUMENT", "设置必须是普通数据对象");
  for (const key of Reflect.ownKeys(input)) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key)!;
    if (
      typeof key !== "string" ||
      !descriptor.enumerable ||
      !("value" in descriptor)
    )
      return fail("BLK-SET-DOCUMENT", "设置必须是可序列化数据字段");
  }
  return input as Record<string, unknown>;
}
function decode(input: unknown): unknown {
  if (typeof input !== "string") return input;
  try {
    return JSON.parse(input);
  } catch {
    return fail("BLK-SET-JSON", "设置文件损坏，无法读取 JSON");
  }
}
function definitionOf(id: string): SettingDefinition {
  const definition = settingDefinitions.find((item) => item.id === id);
  return definition ?? fail("BLK-SET-UNKNOWN", "不支持的设置项");
}
function validateValue(
  definition: SettingDefinition,
  scope: SettingScope,
  value: unknown,
): SettingValue {
  const id = definition.id;
  if (!definition.allowedScopes.includes(scope))
    return fail("BLK-SET-SCOPE", "此设置不能保存在该作用域", id);
  const validType =
    definition.valueType === "boolean"
      ? typeof value === "boolean"
      : definition.valueType === "number"
        ? typeof value === "number" && Number.isFinite(value)
        : typeof value === "string";
  if (!validType) return fail("BLK-SET-TYPE", "设置值类型无效", id);
  for (const rule of definition.validationRules) {
    const valid =
      rule.kind === "integer"
        ? Number.isInteger(value)
        : rule.kind === "minimum"
          ? (value as number) >= (rule.argument as number)
          : rule.kind === "maximum"
            ? (value as number) <= (rule.argument as number)
            : (rule.argument as readonly string[]).includes(value as string);
    if (!valid) return fail(rule.code, rule.message, id);
  }
  // No arbitrary string definitions: enum members are the only admitted strings.
  return value as SettingValue;
}
export function createSettings(scope: SettingScope): SettingsDocument {
  return {
    schemaVersion: "blocky.settings/v1",
    scope: scopeOf(scope),
    values: {},
  };
}
export function parseSettings(input: unknown): SettingsDocument {
  const document = record(decode(input));
  if (document.schemaVersion !== "blocky.settings/v1")
    return fail("BLK-SET-VERSION", "设置版本缺失或不受支持，不能自动覆盖");
  if (
    Object.keys(document).some(
      (key) => !["schemaVersion", "scope", "values"].includes(key),
    )
  )
    return fail("BLK-SET-UNKNOWN", "设置文档包含不支持的字段");
  const output = createSettings(scopeOf(document.scope));
  for (const [id, value] of Object.entries(record(document.values))) {
    const definition = definitionOf(id);
    Object.assign(output.values, {
      [definition.id]: validateValue(definition, output.scope, value),
    });
  }
  return output;
}
export function updateSetting(
  document: SettingsDocument,
  id: string,
  value: unknown,
): SettingsDocument {
  const output = parseSettings(document);
  const definition = definitionOf(id);
  Object.assign(output.values, {
    [definition.id]: validateValue(definition, output.scope, value),
  });
  return output;
}
export function resetSetting(
  document: SettingsDocument,
  id: string,
): SettingsDocument {
  const output = parseSettings(document);
  const definition = definitionOf(id);
  if (!definition.allowedScopes.includes(output.scope))
    return fail("BLK-SET-SCOPE", "此设置不能在该作用域重置", definition.id);
  delete output.values[definition.id];
  return output;
}
export function resolveSetting<K extends SettingId>(
  id: K,
  layers: SettingsLayers,
): { value: SettingValues[K]; source: SettingScope | "default" };
export function resolveSetting(
  id: string,
  layers: SettingsLayers,
): { value: SettingValue; source: SettingScope | "default" };
export function resolveSetting(
  id: string,
  layers: SettingsLayers,
): { value: SettingValue; source: SettingScope | "default" } {
  const definition = definitionOf(id);
  const input = record(layers);
  if (Object.keys(input).some((key) => !scopes.includes(key as SettingScope)))
    return fail("BLK-SET-SCOPE", "继承链包含不支持的作用域");
  let result: { value: SettingValue; source: SettingScope | "default" } = {
    value: definition.defaultValue,
    source: "default",
  };
  for (const scope of scopes) {
    if (!Object.hasOwn(input, scope)) continue;
    const document = parseSettings(input[scope]);
    if (document.scope !== scope)
      return fail("BLK-SET-SCOPE", "设置文档与继承层不匹配");
    const value = document.values[definition.id];
    if (value !== undefined) result = { value, source: scope };
  }
  return result;
}
/** Explicit migration for the unversioned localStorage key `blocky.preferences`. */
export function migratePreferences(input: unknown): SettingsDocument {
  const legacy = record(decode(input));
  const mapping = {
    reduceMotion: "ui.reduceMotion",
    view: "ui.view",
    minimizeToTray: "window.minimizeToTray",
  } as const;
  let result = createSettings("app");
  for (const [key, value] of Object.entries(legacy)) {
    if (!Object.hasOwn(mapping, key))
      return fail("BLK-SET-MIGRATION", "旧偏好包含未知字段，迁移已停止");
    result = updateSetting(result, mapping[key as keyof typeof mapping], value);
  }
  return result;
}
