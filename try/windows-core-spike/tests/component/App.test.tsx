import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { App } from "../../src/app/App";
import { InMemoryHostBridge } from "../../src/host/InMemoryHostBridge";

const EMPTY_WORKSPACE = {
  blocks: {
    languageVersion: 0,
    blocks: [],
  },
};

describe("App", () => {
  it("keeps the builder available while disabling the entire run tab until a valid entry is projected", async () => {
    const user = userEvent.setup();
    render(
      <App
        hostBridge={new InMemoryHostBridge()}
        initialWorkspace={EMPTY_WORKSPACE}
      />,
    );

    expect(screen.getByRole("tab", { name: "搭建助手" })).toBeEnabled();
    expect(screen.getByRole("tab", { name: "运行 Agent" })).toBeDisabled();
    expect(screen.getByText("添加聊天入口后才能运行作品")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "发送给 Agent" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("runtime-send")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "载入100块" }));

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "运行 Agent" })).toBeEnabled();
    });
  });

  it("keeps the static builder isolated and does not focus tabs from pointer selection", async () => {
    const user = userEvent.setup();
    render(
      <App
        hostBridge={new InMemoryHostBridge()}
        initialWorkspace={EMPTY_WORKSPACE}
      />,
    );

    const builderTab = screen.getByRole("tab", { name: "搭建助手" });
    await user.click(builderTab);

    const builderPanel = screen.getByRole("tabpanel", { name: "搭建助手" });
    expect(builderTab).toHaveAttribute("aria-selected", "true");
    expect(builderTab).not.toHaveFocus();
    expect(builderPanel.querySelector("img")).not.toBeInTheDocument();
    expect(builderPanel.querySelector("input, textarea, select")).not.toBeInTheDocument();
    expect(builderPanel).toHaveTextContent(
      "Windows Core 尖峰暂不连接搭建模型。",
    );
    expect(builderPanel).toHaveTextContent(
      "手工编辑、保存、编译和确定性运行不受影响。",
    );
  });
});
