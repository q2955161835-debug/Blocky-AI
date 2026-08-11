import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { App } from "../../src/app/App";
import { createHundredBlockWorkspaceState } from "../../src/blockly/fixtures";
import { InMemoryHostBridge } from "../../src/host/InMemoryHostBridge";
import type { WindowChromeBridge } from "../../src/app/WindowChromeBridge";

async function invokeFileAction(
  user: ReturnType<typeof userEvent.setup>,
  action: string,
): Promise<void> {
  await user.click(screen.getByRole("button", { name: "文件" }));
  await user.click(screen.getByRole("menuitem", { name: new RegExp(`^${action}`) }));
}

describe("App document lifecycle", () => {
  it("saves, marks later edits dirty, and guards New with cancel and discard", async () => {
    const user = userEvent.setup();
    const host = new InMemoryHostBridge();
    render(
      <App
        hostBridge={host}
        initialWorkspace={createHundredBlockWorkspaceState()}
      />,
    );

    await invokeFileAction(user, "另存为…");
    expect(await screen.findByText("未命名 Agent.blocky · 已保存"))
      .toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "搭建助手" }));
    await user.click(screen.getByRole("button", { name: "打开快速入门" }));
    await user.click(screen.getByRole("button", { name: "AI 伙伴" }));
    await user.click(screen.getByRole("button", { name: /智能体.*成员/ }));
    expect(await screen.findByText("未命名 Agent.blocky · 未保存"))
      .toBeInTheDocument();

    await invokeFileAction(user, "新建 Agent");
    const dialog = screen.getByRole("dialog", { name: "保存更改？" });
    expect(dialog).toHaveTextContent("未命名 Agent.blocky");
    await user.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.queryByRole("dialog", { name: "保存更改？" }))
      .not.toBeInTheDocument();
    expect(screen.getByLabelText("画布积木数量")).toHaveTextContent("101 个积木");

    await invokeFileAction(user, "新建 Agent");
    await user.click(screen.getByRole("button", { name: "不保存" }));
    await waitFor(() => expect(screen.getByLabelText("画布积木数量"))
      .toHaveTextContent("0 个积木"));
    expect(screen.getByText("未命名 Agent · 未保存")).toBeInTheDocument();
  });

  it("routes both titlebar close and Exit through the unsaved guard", async () => {
    const user = userEvent.setup();
    const close = vi.fn(async () => {});
    const chrome: WindowChromeBridge = {
      minimize: vi.fn(async () => {}),
      toggleMaximize: vi.fn(async () => {}),
      close,
    };
    render(
      <App
        hostBridge={new InMemoryHostBridge()}
        initialWorkspace={{ blocks: { languageVersion: 0, blocks: [] } }}
        windowChrome={chrome}
      />,
    );

    await user.click(screen.getByRole("button", { name: "关闭窗口" }));
    expect(screen.getByRole("dialog", { name: "保存更改？" })).toBeInTheDocument();
    expect(close).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "取消" }));

    await invokeFileAction(user, "退出");
    await user.click(screen.getByRole("button", { name: "不保存" }));
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
  });
});
