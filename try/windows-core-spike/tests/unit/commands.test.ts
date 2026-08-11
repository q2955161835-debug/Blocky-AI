import { describe, expect, it, vi } from "vitest";
import {
  createWorkbenchCommands,
  matchesShortcut,
  searchWorkbenchItems,
  type CommandBlockItem,
  type WorkbenchCommandId,
} from "../../src/app/commands";

const blockItems: readonly CommandBlockItem[] = [
  {
    kind: "block",
    blockType: "core.interaction.chat_entry",
    label: "聊天入口",
    categoryName: "交互入口",
    keywords: ["消息", "对话"],
  },
  {
    kind: "block",
    blockType: "core.tool.call",
    label: "调用工具",
    categoryName: "工具",
    keywords: ["tool"],
  },
];

function commandFixture(overrides: Partial<Parameters<typeof createWorkbenchCommands>[0]["state"]> = {}) {
  const run = vi.fn<(id: WorkbenchCommandId) => void>();
  const commands = createWorkbenchCommands({
    state: {
      canUndo: true,
      canRedo: false,
      selectionCount: 0,
      canPaste: false,
      leftCollapsed: false,
      rightCollapsed: false,
      tool: "select",
      ...overrides,
    },
    run,
  });
  return { commands, run };
}

describe("workbench commands", () => {
  it("defines the complete file lifecycle with unique shortcuts", () => {
    const { commands } = commandFixture();
    expect(Object.fromEntries(
      commands
        .filter((command) => command.id.startsWith("file."))
        .map((command) => [command.id, command.shortcut]),
    )).toEqual({
      "file.new": "Ctrl+N",
      "file.open": "Ctrl+O",
      "file.save": "Ctrl+S",
      "file.saveAs": "Ctrl+Shift+S",
      "file.exit": "Alt+F4",
    });
    const shortcuts = commands
      .map((command) => command.shortcut)
      .filter((shortcut): shortcut is string => Boolean(shortcut));
    expect(new Set(shortcuts).size).toBe(shortcuts.length);
  });

  it("projects live command enabled and selected states", () => {
    const { commands } = commandFixture({
      canUndo: false,
      canRedo: true,
      selectionCount: 2,
      canPaste: true,
      leftCollapsed: true,
      tool: "pan",
    });
    expect(commands.find((command) => command.id === "edit.undo")?.enabled)
      .toBe(false);
    expect(commands.find((command) => command.id === "edit.redo")?.enabled)
      .toBe(true);
    expect(commands.find((command) => command.id === "edit.delete")?.enabled)
      .toBe(true);
    expect(commands.find((command) => command.id === "edit.paste")?.enabled)
      .toBe(true);
    expect(commands.find((command) => command.id === "view.toggleLeft")?.label)
      .toBe("展开积木库");
    expect(commands.find((command) => command.id === "view.panTool")?.selected)
      .toBe(true);
  });

  it("runs commands through their stable identifiers", () => {
    const { commands, run } = commandFixture();
    commands.find((command) => command.id === "file.open")?.run();
    expect(run).toHaveBeenCalledWith("file.open");
  });

  it("searches commands and registered blocks without duplicating a catalog", () => {
    const { commands } = commandFixture();
    expect(searchWorkbenchItems("另存为", commands, blockItems))
      .toEqual([
        expect.objectContaining({ kind: "command", commandId: "file.saveAs" }),
      ]);
    expect(searchWorkbenchItems("聊天", commands, blockItems))
      .toContainEqual(
        expect.objectContaining({
          kind: "block",
          blockType: "core.interaction.chat_entry",
        }),
      );
    expect(searchWorkbenchItems("不存在", commands, blockItems)).toEqual([]);
  });

  it("matches desktop shortcuts while ignoring auto-repeat and composing input", () => {
    expect(matchesShortcut(
      { key: "o", ctrlKey: true, shiftKey: false, altKey: false, metaKey: false, repeat: false, isComposing: false },
      "Ctrl+O",
    )).toBe(true);
    expect(matchesShortcut(
      { key: "s", ctrlKey: true, shiftKey: true, altKey: false, metaKey: false, repeat: false, isComposing: false },
      "Ctrl+Shift+S",
    )).toBe(true);
    expect(matchesShortcut(
      { key: "s", ctrlKey: true, shiftKey: true, altKey: false, metaKey: false, repeat: true, isComposing: false },
      "Ctrl+Shift+S",
    )).toBe(false);
  });
});
