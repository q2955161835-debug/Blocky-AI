import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  DesktopTitleBar,
  type DesktopTitleBarProps,
} from "../../src/app/DesktopTitleBar";
import type { WindowChromeBridge } from "../../src/app/WindowChromeBridge";

function createProps(
  overrides: Partial<DesktopTitleBarProps> = {},
): DesktopTitleBarProps {
  return {
    projectTitle: "天气助手 · 已保存",
    leftCollapsed: false,
    rightCollapsed: false,
    onToggleLeft: vi.fn(),
    onToggleRight: vi.fn(),
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    onSave: vi.fn(),
    onLoad: vi.fn(),
    onClear: vi.fn(),
    onFit: vi.fn(),
    onLoadFixture: vi.fn(),
    windowChrome: {
      minimize: vi.fn().mockResolvedValue(undefined),
      toggleMaximize: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    },
    ...overrides,
  };
}

describe("DesktopTitleBar", () => {
  it("renders one compact icon titlebar with real menus and panel toggles", async () => {
    const user = userEvent.setup();
    const props = createProps();
    render(<DesktopTitleBar {...props} />);

    expect(screen.getByLabelText("应用标题栏")).toHaveClass("desktop-titlebar");
    expect(screen.getByTestId("titlebar-drag-region")).toHaveAttribute(
      "data-tauri-drag-region",
    );
    expect(screen.getByLabelText("应用标题栏"))
      .not.toHaveAttribute("data-tauri-drag-region");
    expect(screen.getAllByRole("button", { name: "撤销" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "重做" })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "收起积木栏" }))
      .toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "收起运行栏" }))
      .toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "撤销" })).toHaveTextContent("");
    expect(screen.getByText("文件")).toBeInTheDocument();
    expect(screen.getByText("编辑")).toBeInTheDocument();
    expect(screen.getByText("视图")).toBeInTheDocument();
    expect(screen.getByText("帮助")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "收起积木栏" }));
    await user.click(screen.getByRole("button", { name: "收起运行栏" }));
    expect(props.onToggleLeft).toHaveBeenCalledOnce();
    expect(props.onToggleRight).toHaveBeenCalledOnce();
  });

  it("executes menu commands and closes an open menu with Escape", async () => {
    const user = userEvent.setup();
    const props = createProps();
    render(<DesktopTitleBar {...props} />);

    await user.click(screen.getByRole("button", { name: "文件" }));
    expect(screen.getByRole("menu", { name: "文件" })).toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: "保存" }));
    expect(props.onSave).toHaveBeenCalledOnce();
    expect(screen.queryByRole("menu", { name: "文件" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "视图" }));
    expect(screen.getByRole("menu", { name: "视图" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu", { name: "视图" })).not.toBeInTheDocument();
  });

  it("delegates native window controls through the injected bridge", async () => {
    const user = userEvent.setup();
    const windowChrome: WindowChromeBridge = {
      minimize: vi.fn().mockResolvedValue(undefined),
      toggleMaximize: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    };
    render(<DesktopTitleBar {...createProps({ windowChrome })} />);

    await user.click(screen.getByRole("button", { name: "最小化窗口" }));
    await user.click(screen.getByRole("button", { name: "最大化或还原窗口" }));
    await user.click(screen.getByRole("button", { name: "关闭窗口" }));

    expect(windowChrome.minimize).toHaveBeenCalledOnce();
    expect(windowChrome.toggleMaximize).toHaveBeenCalledOnce();
    expect(windowChrome.close).toHaveBeenCalledOnce();
  });
});
