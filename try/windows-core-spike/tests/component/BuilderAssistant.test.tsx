import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { BuilderAssistant } from "../../src/builder/BuilderAssistant";

describe("BuilderAssistant", () => {
  it("offers only real workbench actions needed by the current canvas", async () => {
    const user = userEvent.setup();
    const onAddAgent = vi.fn();
    const onAddChatEntry = vi.fn();
    const onOpenQuickStart = vi.fn();
    const view = render(
      <BuilderAssistant
        hasAgent={false}
        hasChatEntry={false}
        onAddAgent={onAddAgent}
        onAddChatEntry={onAddChatEntry}
        onOpenQuickStart={onOpenQuickStart}
      />,
    );

    expect(screen.queryByText(/技术尖峰|暂不连接/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "添加 AI 伙伴" }));
    await user.click(screen.getByRole("button", { name: "添加聊天入口" }));
    await user.click(screen.getByRole("button", { name: "打开快速入门" }));
    expect(onAddAgent).toHaveBeenCalledOnce();
    expect(onAddChatEntry).toHaveBeenCalledOnce();
    expect(onOpenQuickStart).toHaveBeenCalledOnce();

    view.rerender(
      <BuilderAssistant
        hasAgent
        hasChatEntry
        onAddAgent={onAddAgent}
        onAddChatEntry={onAddChatEntry}
        onOpenQuickStart={onOpenQuickStart}
      />,
    );
    expect(screen.queryByRole("button", { name: "添加 AI 伙伴" }))
      .not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "添加聊天入口" }))
      .not.toBeInTheDocument();
  });
});
