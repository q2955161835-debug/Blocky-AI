import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { App } from "../../src/app/App";
import { createHundredBlockWorkspaceState } from "../../src/blockly/fixtures";
import { InMemoryHostBridge } from "../../src/host/InMemoryHostBridge";

const EMPTY_WORKSPACE = {
  blocks: { languageVersion: 0, blocks: [] },
};

describe("App professional workbench", () => {
  it("starts as a real unsaved document with builder-first navigation and no obsolete controls", async () => {
    const user = userEvent.setup();
    render(<App hostBridge={new InMemoryHostBridge()} initialWorkspace={EMPTY_WORKSPACE} />);

    expect(await screen.findByText("未命名 Agent · 未保存")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "搭建助手" }))
      .toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "对话测试" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "运行" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Windows Core|技术尖峰|载入100块|折叠首块/))
      .not.toBeInTheDocument();
    expect(document.querySelector(".blocklyTrash")).toBeNull();
    expect(screen.getAllByRole("button", { name: "撤销" })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "保存项目" })).toBeInTheDocument();
    expect(screen.getByLabelText("画布缩放")).toBeInTheDocument();

    const runtimeTab = screen.getByRole("tab", { name: "对话测试" });
    runtimeTab.focus();
    await user.keyboard("{Enter}");
    expect(runtimeTab).toHaveAttribute("aria-selected", "true");
  });

  it("collapses either side from the titlebar while leaving the canvas mounted", async () => {
    const user = userEvent.setup();
    render(<App hostBridge={new InMemoryHostBridge()} initialWorkspace={EMPTY_WORKSPACE} />);

    await user.click(screen.getByRole("button", { name: "收起积木栏" }));
    expect(screen.queryByLabelText("积木库")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Blockly 画布")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "收起右侧面板" }));
    expect(screen.queryByRole("complementary", { name: "运行与搭建面板" }))
      .not.toBeInTheDocument();
    expect(screen.getByLabelText("Blockly 画布")).toBeInTheDocument();
  });

  it("routes builder suggestions into the same authentic canvas insertion path", async () => {
    const user = userEvent.setup();
    render(<App hostBridge={new InMemoryHostBridge()} initialWorkspace={EMPTY_WORKSPACE} />);

    await user.click(screen.getByRole("button", { name: "添加 AI 伙伴" }));
    await user.click(screen.getByRole("button", { name: "添加聊天入口" }));
    await waitFor(() => expect(screen.getByLabelText("画布积木数量"))
      .toHaveTextContent("2 个积木"));
    expect(screen.queryByRole("button", { name: "添加 AI 伙伴" }))
      .not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "添加聊天入口" }))
      .not.toBeInTheDocument();
  });

  it("shows an authentic block preview while dragging from the library", async () => {
    render(<App hostBridge={new InMemoryHostBridge()} initialWorkspace={EMPTY_WORKSPACE} />);
    const block = await screen.findByRole("button", { name: "智能体 成员" });

    fireEvent.pointerDown(block, { button: 0, pointerId: 7, clientX: 180, clientY: 220 });
    fireEvent.pointerMove(window, { pointerId: 7, clientX: 230, clientY: 270 });

    expect(screen.getByTestId("block-drag-preview")).toHaveTextContent("智能体 成员");
    fireEvent.pointerCancel(window, { pointerId: 7, clientX: 230, clientY: 270 });
    expect(screen.queryByTestId("block-drag-preview")).not.toBeInTheDocument();
  });

  it("treats chat submission as execution and renders only friendly conversation output", async () => {
    const user = userEvent.setup();
    render(
      <App
        hostBridge={new InMemoryHostBridge()}
        initialWorkspace={createHundredBlockWorkspaceState()}
      />,
    );
    await user.click(screen.getByRole("tab", { name: "对话测试" }));
    await user.type(screen.getByRole("textbox", { name: "发送给 Agent" }), "你好{Enter}");

    expect(await screen.findByText("你好")).toHaveClass("conversation-message--user");
    expect(await screen.findByText("Hello", {
      selector: ".conversation-message--assistant",
    })).toHaveClass(
      "conversation-message--assistant",
    );
    expect(screen.getByRole("button", { name: "执行过程" }))
      .toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(/block-001|blocky\.event|run\.completed/))
      .not.toBeInTheDocument();
  });

  it("exposes real file commands and shortcuts without test fixture commands", async () => {
    const user = userEvent.setup();
    render(<App hostBridge={new InMemoryHostBridge()} initialWorkspace={EMPTY_WORKSPACE} />);
    await user.click(screen.getByRole("button", { name: "文件" }));
    const labels = screen.getAllByRole("menuitem").map((item) => item.textContent ?? "");
    expect(labels.join(" ")).toMatch(/新建 Agent.*Ctrl\+N/);
    expect(labels.join(" ")).toMatch(/打开….*Ctrl\+O/);
    expect(labels.join(" ")).toMatch(/保存.*Ctrl\+S/);
    expect(labels.join(" ")).toMatch(/另存为….*Ctrl\+Shift\+S/);
    expect(labels.join(" ")).not.toMatch(/载入100块|折叠首块|清空|重开/);
  });

  it("makes every Help command open useful product content", async () => {
    const user = userEvent.setup();
    render(<App hostBridge={new InMemoryHostBridge()} initialWorkspace={EMPTY_WORKSPACE} />);

    await user.click(screen.getByRole("button", { name: "帮助" }));
    await user.click(screen.getByRole("menuitem", { name: /^键盘快捷键/ }));
    expect(screen.getByRole("dialog", { name: "键盘快捷键" }))
      .toHaveTextContent("Ctrl+Shift+S");
    await user.click(screen.getByRole("button", { name: "关闭帮助" }));

    await user.click(screen.getByRole("button", { name: "帮助" }));
    await user.click(screen.getByRole("menuitem", { name: /^关于 Blocky/ }));
    expect(screen.getByRole("dialog", { name: "关于 Blocky" }))
      .toHaveTextContent("积木 AI 生产力工作台");
  });
});
