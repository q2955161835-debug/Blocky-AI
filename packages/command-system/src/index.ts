export * from "./bindings";
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
  ["file.migrate", "file", "迁移旧项目", ""],
  ["file.save", "file", "保存项目", "Ctrl+S"],
  ["file.save-as", "file", "另存为", "Ctrl+Shift+S"],
  ["file.new-canvas", "file", "新建画布", "Ctrl+T"],
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
  ["edit.group", "edit", "分组", "Ctrl+G"],
  ["edit.ungroup", "edit", "取消分组", "Ctrl+Shift+G"],
  ["edit.region", "edit", "加入区域", ""],
  ["edit.annotate", "edit", "添加注释", ""],
  ["edit.align-left", "edit", "左对齐", ""],
  ["edit.align-top", "edit", "顶端对齐", ""],
  ["edit.distribute-horizontal", "edit", "水平等距", ""],
  ["edit.distribute-vertical", "edit", "垂直等距", ""],
  ["edit.enable", "edit", "启用所选积木", ""],
  ["edit.disable", "edit", "停用所选积木", ""],
  ["edit.rename-canvas", "edit", "重命名画布", "F2"],
  ["edit.delete-canvas", "edit", "删除当前画布", ""],
  ["view.command-center", "view", "命令中心", "Ctrl+K"],
  ["view.close-tab", "view", "关闭当前标签", "Ctrl+W"],
  ["view.restore-tab", "view", "恢复最近关闭的标签", "Ctrl+Shift+T"],
  ["view.next-tab", "view", "下一个最近使用标签", "Ctrl+Tab"],
  ["view.previous-tab", "view", "上一个最近使用标签", "Ctrl+Shift+Tab"],
  ["view.move-tab-left", "view", "标签左移", ""],
  ["view.move-tab-right", "view", "标签右移", ""],
  ["view.toggle-bottom-panel", "view", "切换底部面板", "Ctrl+J"],
  ["view.show-problems", "view", "问题", ""],
  ["view.show-run-log", "view", "运行日志", ""],
  ["view.back", "view", "返回上一位置", "Alt+ArrowLeft"],
  ["run.start", "run", "运行", "F5"],
  ["run.stop", "run", "停止", "Shift+F5"],
  ["run.pause", "run", "暂停 / 继续问答运行", ""],
  ["run.step", "run", "单步越过", "F10"],
  ["run.from-selection", "run", "从所选积木运行", ""],
  ["run.toggle-breakpoint", "run", "切换断点", "F9"],
  ["window.exit", "window", "退出 Blocky Studio", ""],
  ["build.convert", "build", "从仓库快照生成候选", ""],
  ["build.assistant", "build", "Blocky 构建助手", ""],
  ["build.surface", "build", "创建应用界面", ""],
  ["terminal.create", "terminal", "新建终端", ""],
  ["terminal.stop", "terminal", "关闭当前终端", ""],
  ["terminal.run-task", "terminal", "运行项目检查", ""],
  ["terminal.stop-task", "terminal", "停止任务", ""],
  ["settings.open", "settings", "设置", "Ctrl+,"],
  ["settings.resources", "settings", "资源管理", ""],
  ["help.about", "help", "关于 Blocky Studio", ""],
  ["help.shortcuts", "help", "快捷键", ""],
];
export const commands: CommandDefinition[] = specs.map(
  ([commandId, category, label, key]) => ({
    schemaVersion: "blocky.command/v1alpha1",
    commandId,
    category,
    label,
    defaultShortcuts: [
      ...(key ? [key] : []),
      ...(commandId === "edit.redo" ? ["Ctrl+Shift+Z"] : []),
      ...(commandId === "run.start" ? ["Ctrl+Enter"] : []),
      ...(commandId === "run.stop" ? ["Escape"] : []),
      ...(commandId === "view.command-center" ? ["Ctrl+Shift+P"] : []),
    ],
    contexts: ["studio"],
    selection: commandId === "edit.blueprint" ? "multiple" : "any",
    danger: commandId === "edit.delete-canvas" ? "destructive" : "none",
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
export type CommandState = { enabled: boolean; reason?: string };
export function createCommandDispatcher(
  actions: Record<string, () => unknown>,
  disabledReason: (id: string) => string | undefined,
) {
  const state = (id: string): CommandState => {
    if (
      !commands.some((c) => c.commandId === id) ||
      !Object.hasOwn(actions, id)
    )
      return { enabled: false, reason: "此能力尚不可用" };
    const reason = disabledReason(id);
    return reason ? { enabled: false, reason } : { enabled: true };
  };
  return {
    state,
    execute(id: string) {
      if (!state(id).enabled) return false;
      actions[id]();
      return true;
    },
  };
}
