import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { App } from "../../src/app/App";
import { createHundredBlockWorkspaceState } from "../../src/blockly/fixtures";
import { countSerializedBlocks } from "../../src/blockly/fixtures";
import { stableStringify } from "../../src/core/json";
import type { HostBridge } from "../../src/host/HostBridge";
import { InMemoryHostBridge } from "../../src/host/InMemoryHostBridge";
import { createWdioCanvasAction } from "../../src/test/wdioBootstrap";

const EMPTY_WORKSPACE = {
  blocks: {
    languageVersion: 0,
    blocks: [],
  },
};

describe("App", () => {
  it("restores 100 unique block IDs with byte-stable project JSON after save, clear, and reload", async () => {
    const user = userEvent.setup();
    const host = new InMemoryHostBridge();
    const firstMount = render(
      <App hostBridge={host} initialWorkspace={EMPTY_WORKSPACE} />,
    );

    await user.click(screen.getByRole("button", { name: "载入100块" }));
    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "运行 Agent" })).toBeEnabled();
    });
    await user.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(async () => {
      expect(await host.loadProject("windows-core-spike")).not.toBeNull();
    });
    const before = await host.loadProject("windows-core-spike");
    if (!before) throw new Error("Expected the first project save");
    const stableBefore = stableStringify(before);

    firstMount.unmount();
    render(<App hostBridge={host} initialWorkspace={EMPTY_WORKSPACE} />);
    expect(screen.getByRole("tab", { name: "运行 Agent" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "重开" }));
    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "运行 Agent" })).toBeEnabled();
    });
    await user.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(async () => {
      const current = await host.loadProject("windows-core-spike");
      expect(current && stableStringify(current)).toBe(stableBefore);
    });

    const after = await host.loadProject("windows-core-spike");
    if (!after) throw new Error("Expected the reloaded project save");
    const blockIds = new Set<string>();
    const collectBlockIds = (value: unknown): void => {
      if (!value || typeof value !== "object") return;
      if (Array.isArray(value)) {
        value.forEach(collectBlockIds);
        return;
      }
      const record = value as Record<string, unknown>;
      if (typeof record.type === "string" && typeof record.id === "string") {
        blockIds.add(record.id);
      }
      Object.values(record).forEach(collectBlockIds);
    };
    collectBlockIds(after.workspace);

    expect(countSerializedBlocks(after.workspace)).toBe(100);
    expect(blockIds.size).toBe(100);
    expect(stableStringify(after)).toBe(stableBefore);
  });

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

  it("clears the loaded workspace through a visible project action", async () => {
    const user = userEvent.setup();
    render(
      <App
        hostBridge={new InMemoryHostBridge()}
        initialWorkspace={createHundredBlockWorkspaceState()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "运行 Agent" })).toBeEnabled();
    });
    await user.click(screen.getByRole("button", { name: "清空" }));

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "运行 Agent" })).toBeDisabled();
    });
    expect(screen.getByText("添加聊天入口后才能运行作品")).toBeInTheDocument();
  });

  it("collapses the first top-level block through the visible canvas action", async () => {
    const user = userEvent.setup();
    const host = new InMemoryHostBridge();
    render(
      <App
        hostBridge={host}
        initialWorkspace={createHundredBlockWorkspaceState()}
        canvasAction={createWdioCanvasAction()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "运行 Agent" })).toBeEnabled();
    });
    await user.click(screen.getByRole("button", { name: "折叠首块" }));
    await user.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(async () => {
      const saved = await host.loadProject("windows-core-spike");
      const workspace = saved?.workspace as {
        blocks?: { blocks?: Array<{ collapsed?: boolean; id?: string }> };
      } | undefined;
      expect(workspace?.blocks?.blocks?.find((block) => block.id === "block-001"))
        .toMatchObject({ collapsed: true });
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

  it("keeps both tabpanels mounted so runtime drafts and attachments survive builder switching", async () => {
    const user = userEvent.setup();
    render(
      <App
        hostBridge={new InMemoryHostBridge()}
        initialWorkspace={createHundredBlockWorkspaceState()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "运行 Agent" })).toBeEnabled();
    });
    await user.type(screen.getByTestId("runtime-text-input"), "跨 tab 草稿");
    fireEvent.change(screen.getByLabelText("图片"), {
      target: { files: [new File(["photo"], "persist.png", { type: "image/png" })] },
    });

    await user.click(screen.getByRole("tab", { name: "搭建助手" }));

    const builderPanel = document.getElementById("builder-panel");
    const runtimePanel = document.getElementById("runtime-panel");
    expect(builderPanel).not.toHaveAttribute("hidden");
    expect(runtimePanel).toHaveAttribute("hidden");
    expect(builderPanel?.querySelector("form, input, textarea, select, button")).toBeNull();
    expect(screen.getByTestId("runtime-text-input")).toHaveValue("跨 tab 草稿");
    expect(screen.getByText("persist.png")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "运行 Agent" }));

    expect(runtimePanel).not.toHaveAttribute("hidden");
    expect(screen.getByTestId("runtime-text-input")).toHaveValue("跨 tab 草稿");
    expect(screen.getByText("persist.png")).toBeInTheDocument();
  });

  it("shows fixed Chinese host errors without leaking rejection details", async () => {
    const user = userEvent.setup();
    const rejectingHost: HostBridge = {
      saveProject: async () => {
        throw new Error("SECRET_SAVE_DETAIL");
      },
      loadProject: async () => {
        throw new Error("SECRET_LOAD_DETAIL");
      },
    };
    render(
      <App hostBridge={rejectingHost} initialWorkspace={EMPTY_WORKSPACE} />,
    );

    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("保存失败，请重试");
    expect(screen.getByRole("alert")).not.toHaveTextContent("SECRET_SAVE_DETAIL");

    await user.click(screen.getByRole("button", { name: "重开" }));
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("载入失败，请重试");
    });
    expect(screen.getByRole("alert")).not.toHaveTextContent("SECRET_LOAD_DETAIL");
  });

  it("keeps the real /error draft after run.failed while showing only the safe alert", async () => {
    const user = userEvent.setup();
    render(
      <App
        hostBridge={new InMemoryHostBridge()}
        initialWorkspace={createHundredBlockWorkspaceState()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "运行 Agent" })).toBeEnabled();
    });
    await user.type(screen.getByTestId("runtime-text-input"), "/error");
    await user.click(screen.getByTestId("runtime-send"));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "运行失败，请检查积木后重试",
    );
    expect(screen.getByRole("alert")).not.toHaveTextContent(
      "MODEL_SIMULATED_FAILURE",
    );
    expect(screen.getByTestId("runtime-text-input")).toHaveValue("/error");
  });

  it("clears the real draft only after run.completed", async () => {
    const user = userEvent.setup();
    render(
      <App
        hostBridge={new InMemoryHostBridge()}
        initialWorkspace={createHundredBlockWorkspaceState()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "运行 Agent" })).toBeEnabled();
    });
    await user.type(screen.getByTestId("runtime-text-input"), "成功草稿");
    await user.click(screen.getByTestId("runtime-send"));

    await waitFor(() => {
      expect(screen.getByTestId("runtime-text-input")).toHaveValue("");
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows the requested Tool and permissions until the user explicitly denies it", async () => {
    const user = userEvent.setup();
    render(
      <App
        hostBridge={new InMemoryHostBridge()}
        initialWorkspace={createHundredBlockWorkspaceState()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "运行 Agent" })).toBeEnabled();
    });
    await user.type(screen.getByTestId("runtime-text-input"), "/permission");
    await user.click(screen.getByTestId("runtime-send"));

    const request = await screen.findByRole("alertdialog", { name: "工具权限请求" });
    expect(request).toHaveTextContent("tool.weather");
    expect(request).toHaveTextContent("无额外权限");
    await user.click(screen.getByRole("button", { name: "拒绝" }));

    await waitFor(() => {
      expect(screen.queryByRole("alertdialog", { name: "工具权限请求" })).not.toBeInTheDocument();
    });
    expect(screen.getByText("run.failed")).toBeInTheDocument();
    expect(screen.queryByText("tool.started")).not.toBeInTheDocument();
  });

  it("executes an approved Tool only after the visible permission action", async () => {
    const user = userEvent.setup();
    render(
      <App
        hostBridge={new InMemoryHostBridge()}
        initialWorkspace={createHundredBlockWorkspaceState()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "运行 Agent" })).toBeEnabled();
    });
    await user.type(screen.getByTestId("runtime-text-input"), "/permission");
    await user.click(screen.getByTestId("runtime-send"));
    await screen.findByRole("alertdialog", { name: "工具权限请求" });
    await user.click(screen.getByRole("button", { name: "批准" }));

    expect(await screen.findByText("tool.completed")).toBeInTheDocument();
    expect(screen.getByText("run.completed")).toBeInTheDocument();
  });

  it("cancels a run that is waiting for permission without completing it", async () => {
    const user = userEvent.setup();
    render(
      <App
        hostBridge={new InMemoryHostBridge()}
        initialWorkspace={createHundredBlockWorkspaceState()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "运行 Agent" })).toBeEnabled();
    });
    await user.type(screen.getByTestId("runtime-text-input"), "/permission");
    await user.click(screen.getByTestId("runtime-send"));
    await screen.findByRole("alertdialog", { name: "工具权限请求" });
    await user.click(screen.getByRole("button", { name: "取消运行" }));

    expect(await screen.findByText("run.cancelled")).toBeInTheDocument();
    expect(screen.queryByText("run.completed")).not.toBeInTheDocument();
  });
});
