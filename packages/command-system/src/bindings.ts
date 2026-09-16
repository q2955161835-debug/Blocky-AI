import { commands } from "./index";
export type ShortcutBindings = {
  schemaVersion: "blocky.shortcuts/v1";
  overrides: Record<string, string[]>;
};
export const emptyBindings = (): ShortcutBindings => ({
  schemaVersion: "blocky.shortcuts/v1",
  overrides: {},
});
export function normalizeShortcut(value: string): string {
  const parts = value.trim().split("+");
  const key = parts.pop() ?? "";
  if (
    !key ||
    parts.some((p) => !["Ctrl", "Shift", "Alt"].includes(p)) ||
    new Set(parts).size !== parts.length ||
    !/^(?:[A-Za-z0-9,.;/`\[\]\\=-]|F(?:[1-9]|1[0-2])|Enter|Escape|Tab|Delete|Backspace|Arrow(?:Left|Right|Up|Down)|Home|End|PageUp|PageDown)$/.test(
      key,
    )
  )
    throw Error("快捷键格式无效");
  const normalized = [
    ...["Ctrl", "Shift", "Alt"].filter((p) => parts.includes(p)),
    key.length === 1 ? key.toUpperCase() : key,
  ].join("+");
  if (
    ["Alt+F4", "Ctrl+Alt+Delete", "Ctrl+Shift+Escape", "Alt+Tab"].includes(
      normalized,
    )
  )
    throw Error("此快捷键由系统保留");
  return normalized;
}
export function bindingsFor(doc: ShortcutBindings, id: string): string[] {
  return (
    doc.overrides[id] ??
    commands.find((c) => c.commandId === id)?.defaultShortcuts ??
    []
  );
}
export function shortcutConflicts(
  doc: ShortcutBindings,
): { key: string; commands: string[] }[] {
  const all = new Map<string, string[]>();
  for (const command of commands)
    for (const key of bindingsFor(doc, command.commandId))
      all.set(key, [...(all.get(key) ?? []), command.commandId]);
  return [...all]
    .filter(([, owners]) => owners.length > 1)
    .map(([key, owners]) => ({ key, commands: owners }));
}
export function parseBindings(raw: unknown): ShortcutBindings {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw Error("快捷键配置无效");
  const doc = raw as ShortcutBindings;
  if (
    doc.schemaVersion !== "blocky.shortcuts/v1" ||
    !doc.overrides ||
    typeof doc.overrides !== "object" ||
    Array.isArray(doc.overrides) ||
    Object.keys(doc).some((k) => !["schemaVersion", "overrides"].includes(k))
  )
    throw Error("快捷键配置无效");
  const next = emptyBindings();
  for (const [id, keys] of Object.entries(doc.overrides)) {
    if (
      !commands.some((c) => c.commandId === id) ||
      !Array.isArray(keys) ||
      keys.length > 4 ||
      keys.some((k) => typeof k !== "string")
    )
      throw Error("快捷键配置无效");
    next.overrides[id] = [...new Set(keys.map(normalizeShortcut))];
  }
  if (shortcutConflicts(next).length) throw Error("快捷键冲突");
  return next;
}
export function changeBinding(
  doc: ShortcutBindings,
  id: string,
  keys: string[] | undefined,
): ShortcutBindings {
  const next = structuredClone(doc);
  if (keys === undefined) delete next.overrides[id];
  else next.overrides[id] = keys;
  return parseBindings(next);
}
