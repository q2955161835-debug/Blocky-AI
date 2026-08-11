import type { SpikeBlockId } from "../blockly/catalog";

export type CanvasTool = "select" | "pan";
export type WorkbenchMenuId = "file" | "edit" | "view" | "help";
export type WorkbenchCommandId =
  | "file.new"
  | "file.open"
  | "file.save"
  | "file.saveAs"
  | "file.exit"
  | "edit.undo"
  | "edit.redo"
  | "edit.selectAll"
  | "edit.cut"
  | "edit.copy"
  | "edit.paste"
  | "edit.delete"
  | "view.toggleLeft"
  | "view.toggleRight"
  | "view.selectTool"
  | "view.panTool"
  | "view.zoomIn"
  | "view.zoomOut"
  | "view.resetZoom"
  | "view.fit"
  | "help.quickStart"
  | "help.shortcuts"
  | "help.about";

export interface WorkbenchCommandState {
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly selectionCount: number;
  readonly canPaste: boolean;
  readonly leftCollapsed: boolean;
  readonly rightCollapsed: boolean;
  readonly tool: CanvasTool;
}

export interface WorkbenchCommandContext {
  readonly state: WorkbenchCommandState;
  readonly run: (id: WorkbenchCommandId) => void;
}

export interface WorkbenchCommand {
  readonly kind: "command";
  readonly id: WorkbenchCommandId;
  readonly label: string;
  readonly menu: WorkbenchMenuId;
  readonly shortcut?: string;
  readonly enabled: boolean;
  readonly selected?: boolean;
  readonly keywords: readonly string[];
  run(): void;
}

export interface CommandBlockItem {
  readonly kind: "block";
  readonly blockType: SpikeBlockId;
  readonly label: string;
  readonly categoryName: string;
  readonly keywords: readonly string[];
}

export interface CommandSearchItem {
  readonly kind: "command";
  readonly commandId: WorkbenchCommandId;
  readonly label: string;
  readonly detail: string;
  readonly shortcut?: string;
  readonly enabled: boolean;
}

export type WorkbenchSearchItem = CommandSearchItem | CommandBlockItem;

interface CommandDefinition {
  readonly id: WorkbenchCommandId;
  readonly label: string | ((state: WorkbenchCommandState) => string);
  readonly menu: WorkbenchMenuId;
  readonly shortcut?: string;
  readonly enabled?: (state: WorkbenchCommandState) => boolean;
  readonly selected?: (state: WorkbenchCommandState) => boolean;
  readonly keywords?: readonly string[];
}

const DEFINITIONS: readonly CommandDefinition[] = [
  { id: "file.new", label: "新建 Agent", menu: "file", shortcut: "Ctrl+N", keywords: ["新项目"] },
  { id: "file.open", label: "打开…", menu: "file", shortcut: "Ctrl+O", keywords: ["文件"] },
  { id: "file.save", label: "保存", menu: "file", shortcut: "Ctrl+S" },
  { id: "file.saveAs", label: "另存为…", menu: "file", shortcut: "Ctrl+Shift+S" },
  { id: "file.exit", label: "退出", menu: "file", shortcut: "Alt+F4", keywords: ["关闭"] },
  { id: "edit.undo", label: "撤销", menu: "edit", shortcut: "Ctrl+Z", enabled: (state) => state.canUndo },
  { id: "edit.redo", label: "重做", menu: "edit", shortcut: "Ctrl+Y", enabled: (state) => state.canRedo },
  { id: "edit.selectAll", label: "全选", menu: "edit", shortcut: "Ctrl+A" },
  { id: "edit.cut", label: "剪切", menu: "edit", shortcut: "Ctrl+X", enabled: (state) => state.selectionCount > 0 },
  { id: "edit.copy", label: "复制", menu: "edit", shortcut: "Ctrl+C", enabled: (state) => state.selectionCount > 0 },
  { id: "edit.paste", label: "粘贴", menu: "edit", shortcut: "Ctrl+V", enabled: (state) => state.canPaste },
  { id: "edit.delete", label: "删除", menu: "edit", shortcut: "Delete", enabled: (state) => state.selectionCount > 0 },
  {
    id: "view.toggleLeft",
    label: (state) => state.leftCollapsed ? "展开积木库" : "收起积木库",
    menu: "view",
    keywords: ["左侧栏"],
  },
  {
    id: "view.toggleRight",
    label: (state) => state.rightCollapsed ? "展开右侧面板" : "收起右侧面板",
    menu: "view",
    keywords: ["对话测试", "搭建助手"],
  },
  { id: "view.selectTool", label: "选择模式", menu: "view", shortcut: "V", selected: (state) => state.tool === "select", keywords: ["框选"] },
  { id: "view.panTool", label: "平移模式", menu: "view", shortcut: "H", selected: (state) => state.tool === "pan", keywords: ["拖动画布"] },
  { id: "view.zoomIn", label: "放大", menu: "view", keywords: ["缩放"] },
  { id: "view.zoomOut", label: "缩小", menu: "view", keywords: ["缩放"] },
  { id: "view.resetZoom", label: "重置为 100%", menu: "view", keywords: ["缩放"] },
  { id: "view.fit", label: "适配画布", menu: "view", keywords: ["缩放", "居中"] },
  { id: "help.quickStart", label: "快速入门", menu: "help", keywords: ["教程"] },
  { id: "help.shortcuts", label: "键盘快捷键", menu: "help", keywords: ["按键"] },
  { id: "help.about", label: "关于 Blocky", menu: "help", keywords: ["版本"] },
];

export function createWorkbenchCommands(
  context: WorkbenchCommandContext,
): readonly WorkbenchCommand[] {
  return DEFINITIONS.map((definition) => {
    const enabled = definition.enabled?.(context.state) ?? true;
    const command: WorkbenchCommand = {
      kind: "command",
      id: definition.id,
      label: typeof definition.label === "function"
        ? definition.label(context.state)
        : definition.label,
      menu: definition.menu,
      ...(definition.shortcut ? { shortcut: definition.shortcut } : {}),
      enabled,
      ...(definition.selected
        ? { selected: definition.selected(context.state) }
        : {}),
      keywords: definition.keywords ?? [],
      run: () => {
        if (enabled) context.run(definition.id);
      },
    };
    return Object.freeze(command);
  });
}

function normalizeSearch(value: string): string {
  return value.trim().toLocaleLowerCase("zh-CN");
}

function includesQuery(values: readonly string[], query: string): boolean {
  return values.some((value) => normalizeSearch(value).includes(query));
}

export function searchWorkbenchItems(
  query: string,
  commands: readonly WorkbenchCommand[],
  blocks: readonly CommandBlockItem[],
): readonly WorkbenchSearchItem[] {
  const normalized = normalizeSearch(query);
  const commandItems = commands
    .filter((command) => !normalized || includesQuery(
      [command.label, command.menu, command.id, ...command.keywords],
      normalized,
    ))
    .map<CommandSearchItem>((command) => ({
      kind: "command",
      commandId: command.id,
      label: command.label,
      detail: command.menu,
      ...(command.shortcut ? { shortcut: command.shortcut } : {}),
      enabled: command.enabled,
    }));
  const blockItems = blocks.filter((block) => !normalized || includesQuery(
    [block.label, block.categoryName, block.blockType, ...block.keywords],
    normalized,
  ));
  return [...commandItems, ...blockItems].slice(0, 40);
}

export interface ShortcutEventLike {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly metaKey: boolean;
  readonly repeat: boolean;
  readonly isComposing: boolean;
}

export function matchesShortcut(
  event: ShortcutEventLike,
  shortcut: string,
): boolean {
  if (event.repeat || event.isComposing) return false;
  const parts = shortcut.split("+");
  const expectedKey = parts.at(-1)?.toLocaleLowerCase("en-US") ?? "";
  return event.key.toLocaleLowerCase("en-US") === expectedKey &&
    event.ctrlKey === parts.includes("Ctrl") &&
    event.shiftKey === parts.includes("Shift") &&
    event.altKey === parts.includes("Alt") &&
    event.metaKey === parts.includes("Meta");
}
