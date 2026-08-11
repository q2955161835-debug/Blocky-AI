import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DesktopTitleBar } from "../../src/app/DesktopTitleBar";
import {
  createWorkbenchCommands,
  type CommandBlockItem,
  type WorkbenchCommandId,
} from "../../src/app/commands";
import type { WindowChromeBridge } from "../../src/app/WindowChromeBridge";

vi.mock("@fluentui/react-icons", async (importOriginal) => {
  const original = await importOriginal<typeof import("@fluentui/react-icons")>();
  return {
    ...original,
    ArrowLeft20Regular: () => <svg data-testid="straight-undo-icon" />,
    ArrowRight20Regular: () => <svg data-testid="straight-redo-icon" />,
  };
});

const blockSearchItems: readonly CommandBlockItem[] = [
  {
    kind: "block",
    blockType: "core.interaction.chat_entry",
    label: "聊天入口",
    categoryName: "交互入口",
    keywords: ["对话"],
  },
];

function createFixture(overrides: { canUndo?: boolean; canRedo?: boolean } = {}) {
  const runCommand = vi.fn<(id: WorkbenchCommandId) => void>();
  const commands = createWorkbenchCommands({
    state: {
      canUndo: overrides.canUndo ?? true,
      canRedo: overrides.canRedo ?? false,
      selectionCount: 0,
      canPaste: false,
      leftCollapsed: false,
      rightCollapsed: false,
      tool: "select",
    },
    run: runCommand,
  });
  const windowChrome: WindowChromeBridge = {
    minimize: vi.fn().mockResolvedValue(undefined),
    toggleMaximize: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  };
  const onInsertBlock = vi.fn();
  return { commands, runCommand, windowChrome, onInsertBlock };
}

describe("DesktopTitleBar", () => {
  it("renders straight history arrows, a live document label, and real command menus", async () => {
    const user = userEvent.setup();
    const fixture = createFixture();
    render(
      <DesktopTitleBar
        commands={fixture.commands}
        blockSearchItems={blockSearchItems}
        documentLabel="未命名 Agent · 未保存"
        leftCollapsed={false}
        rightCollapsed={false}
        onInsertBlock={fixture.onInsertBlock}
        windowChrome={fixture.windowChrome}
      />,
    );

    expect(screen.getByText("未命名 Agent · 未保存")).toBeInTheDocument();
    expect(screen.getByTestId("straight-undo-icon")).toBeInTheDocument();
    expect(screen.getByTestId("straight-redo-icon")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "撤销" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "重做" })).toBeDisabled();
    expect(screen.queryByText(/载入100块|技术尖峰/)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "文件" }));
    expect(screen.getByRole("menuitem", { name: /新建 Agent.*Ctrl\+N/ }))
      .toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /打开….*Ctrl\+O/ }))
      .toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /另存为….*Ctrl\+Shift\+S/ }))
      .toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: /打开….*Ctrl\+O/ }));
    expect(fixture.runCommand).toHaveBeenCalledWith("file.open");
    expect(screen.queryByRole("menu", { name: "文件" })).not.toBeInTheDocument();
  });

  it("focuses Ctrl+P command search and inserts a matched catalog block", async () => {
    const user = userEvent.setup();
    const fixture = createFixture();
    render(
      <DesktopTitleBar
        commands={fixture.commands}
        blockSearchItems={blockSearchItems}
        documentLabel="weather.blocky · 已保存"
        leftCollapsed={false}
        rightCollapsed={false}
        onInsertBlock={fixture.onInsertBlock}
        windowChrome={fixture.windowChrome}
      />,
    );

    await user.keyboard("{Control>}p{/Control}");
    const search = screen.getByRole("combobox", { name: "搜索积木和命令" });
    expect(search).toHaveFocus();
    await user.type(search, "聊天");
    expect(screen.getByRole("option", { name: /聊天入口.*交互入口/ }))
      .toBeInTheDocument();
    await user.keyboard("{Enter}");
    expect(fixture.onInsertBlock).toHaveBeenCalledWith(
      "core.interaction.chat_entry",
    );
  });

  it("supports keyboard menu navigation and native window controls", async () => {
    const user = userEvent.setup();
    const fixture = createFixture();
    render(
      <DesktopTitleBar
        commands={fixture.commands}
        blockSearchItems={blockSearchItems}
        documentLabel="weather.blocky · 已保存"
        leftCollapsed={false}
        rightCollapsed={false}
        onInsertBlock={fixture.onInsertBlock}
        windowChrome={fixture.windowChrome}
      />,
    );

    await user.click(screen.getByRole("button", { name: "视图" }));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu", { name: "视图" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "最小化窗口" }));
    await user.click(screen.getByRole("button", { name: "最大化或还原窗口" }));
    await user.click(screen.getByRole("button", { name: "关闭窗口" }));
    expect(fixture.windowChrome.minimize).toHaveBeenCalledOnce();
    expect(fixture.windowChrome.toggleMaximize).toHaveBeenCalledOnce();
    expect(fixture.windowChrome.close).toHaveBeenCalledOnce();
  });
});
