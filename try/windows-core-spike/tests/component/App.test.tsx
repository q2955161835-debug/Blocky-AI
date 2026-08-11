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

type AppUser = ReturnType<typeof userEvent.setup>;

async function invokeMenuAction(
  user: AppUser,
  menu: "文件" | "编辑" | "视图" | "帮助",
  action: string,
): Promise<void> {
  await user.click(screen.getByRole("button", { name: menu }));
  await user.click(screen.getByRole("menuitem", { name: action }));
}

describe("App", () => {
  it("recomposes the approved fourth-version workbench without a second toolbar", async () => {
    const user = userEvent.setup();
    render(
      <App
        hostBridge={new InMemoryHostBridge()}
        initialWorkspace={EMPTY_WORKSPACE}
      />,
    );

    expect(screen.getAllByRole("button", { name: "撤销" })).toHaveLength(1);
    expect(screen.queryByLabelText("项目操作")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存项目" }))
      .toHaveClass("canvas-controls__save");
    expect(screen.getByLabelText("画布缩放"))
      .toHaveClass("canvas-controls__zoom");
    expect(screen.getByLabelText("积木库")).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "运行与搭建面板" }))
      .toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "收起积木栏" }));
    expect(screen.queryByLabelText("积木库")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "展开积木栏" }))
      .toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("button", { name: "收起运行栏" }));
    expect(screen.queryByRole("complementary", { name: "运行与搭建面板" }))
      .not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "运行" }));
    expect(screen.getByRole("complementary", { name: "运行与搭建面板" }))
      .toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "运行 Agent" }))
      .toHaveAttribute("aria-selected", "true");
  });

  it("exposes an accessible explicit fit-to-view action", () => {
    render(
      <App
        hostBridge={new InMemoryHostBridge()}
        initialWorkspace={EMPTY_WORKSPACE}
      />,
    );

    expect(
      screen.getByRole("button", { name: "适配画布" }),
    ).toBeInTheDocument();
    const mediaReferences = [...document.querySelectorAll("image")].map(
      (image) => image.getAttribute("href") ?? image.getAttribute("xlink:href"),
    );
    expect(mediaReferences.length).toBeGreaterThan(0);
    expect(mediaReferences.every((reference) =>
      reference === "./blockly-media/sprites.svg"
    )).toBe(true);
  });

  it("restores 100 unique block IDs with byte-stable project JSON after save, clear, and reload", async () => {
    const user = userEvent.setup();
    const host = new InMemoryHostBridge();
    const firstMount = render(
      <App hostBridge={host} initialWorkspace={EMPTY_WORKSPACE} />,
    );

    await invokeMenuAction(user, "视图", "载入100块");
    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "运行 Agent" })).toBeEnabled();
    });
    await user.click(screen.getByRole("button", { name: "保存项目" }));
    await waitFor(async () => {
      expect(await host.loadProject("windows-core-spike")).not.toBeNull();
    });
    const before = await host.loadProject("windows-core-spike");
    if (!before) throw new Error("Expected the first project save");
    const stableBefore = stableStringify(before);

    firstMount.unmount();
    render(<App hostBridge={host} initialWorkspace={EMPTY_WORKSPACE} />);
    expect(screen.getByRole("tab", { name: "运行 Agent" })).toBeDisabled();

    await invokeMenuAction(user, "文件", "重开");
    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "运行 Agent" })).toBeEnabled();
    });
    await user.click(screen.getByRole("button", { name: "保存项目" }));
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

    await invokeMenuAction(user, "视图", "载入100块");

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
    await invokeMenuAction(user, "文件", "清空");

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
    await invokeMenuAction(user, "视图", "折叠首块");
    await user.click(screen.getByRole("button", { name: "保存项目" }));

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
      openDocument: async () => {
        throw new Error("SECRET_OPEN_DETAIL");
      },
      saveDocument: async () => {
        throw new Error("SECRET_DOCUMENT_SAVE_DETAIL");
      },
      clearDocumentAssociation: async () => {},
    };
    render(
      <App hostBridge={rejectingHost} initialWorkspace={EMPTY_WORKSPACE} />,
    );

    await user.click(screen.getByRole("button", { name: "保存项目" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("保存失败，请重试");
    expect(screen.getByRole("alert")).not.toHaveTextContent("SECRET_SAVE_DETAIL");

    await invokeMenuAction(user, "文件", "重开");
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
