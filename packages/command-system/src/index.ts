export type CommandDefinition = {
  schemaVersion: "blocky.command/v1alpha1";
  commandId: string;
  category:
    | "file"
    | "edit"
    | "view"
    | "run"
    | "build"
    | "window"
    | "settings"
    | "help"
    | "terminal"
    | "logs";
  label: string;
  defaultShortcuts: string[];
  contexts: string[];
  selection: "none" | "single" | "multiple" | "any";
  danger: "none" | "confirm" | "destructive";
  undo: "not-applicable" | "undoable" | "checkpoint";
};
const specs: [string, CommandDefinition["category"], string, string][] = [
  ["file.new", "file", "新建项目", "Ctrl+N"],
  ["file.open", "file", "打开项目", "Ctrl+O"],
  ["file.save", "file", "保存项目", "Ctrl+S"],
  ["edit.undo", "edit", "撤销", "Ctrl+Z"],
  ["edit.redo", "edit", "重做", "Ctrl+Y"],
  ["edit.blueprint", "edit", "保存为蓝图", ""],
  ["edit.copy", "edit", "复制积木", "Ctrl+C"],
  ["edit.duplicate", "edit", "复制副本", "Ctrl+D"],
  ["edit.cut", "edit", "剪切积木", "Ctrl+X"],
  ["edit.paste", "edit", "粘贴积木", "Ctrl+V"],
  ["edit.delete", "edit", "删除选择", "Delete"],
  ["edit.select-all", "edit", "选择全部积木", "Ctrl+A"],
  ["edit.clear-selection", "edit", "清除选择", ""],
  ["edit.collapse", "edit", "折叠选择", ""],
  ["edit.expand", "edit", "展开选择", ""],
  ["view.toggle-bottom-panel", "view", "切换底部面板", "Ctrl+J"],
  ["view.show-problems", "view", "问题", ""],
  ["view.show-run-log", "view", "运行日志", ""],
  ["view.back", "view", "返回上一位置", "Alt+ArrowLeft"],
  ["run.start", "run", "运行", "Ctrl+Enter"],
  ["run.stop", "run", "停止", "Escape"],
  ["build.convert", "build", "从仓库快照生成候选", ""],
  ["build.surface", "build", "创建应用界面", ""],
  ["terminal.create", "terminal", "运行项目检查", ""],
  ["terminal.stop", "terminal", "停止任务", ""],
  ["settings.open", "settings", "设置", "Ctrl+,"],
];
export const commands: CommandDefinition[] = specs.map(
  ([commandId, category, label, key]) => ({
    schemaVersion: "blocky.command/v1alpha1",
    commandId,
    category,
    label,
    defaultShortcuts: key ? [key] : [],
    contexts: ["studio"],
    selection: commandId === "edit.blueprint" ? "multiple" : "any",
    danger: "none",
    undo:
      category === "edit" &&
      ![
        "edit.copy",
        "edit.select-all",
        "edit.clear-selection",
        "edit.blueprint",
      ].includes(commandId)
        ? "undoable"
        : "not-applicable",
  }),
);
export function shortcut(event: {
  key: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}) {
  return `${event.ctrlKey ? "Ctrl+" : ""}${event.shiftKey ? "Shift+" : ""}${event.altKey ? "Alt+" : ""}${event.key.length === 1 ? event.key.toUpperCase() : event.key}`;
}
