import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import "../../src/app/app.css";
import type { InteractionManifest } from "../../src/core/interactionManifest";
import type { RuntimeEvent } from "../../src/core/runtimeEvents";
import { RuntimePanel, type RuntimePanelProps } from "../../src/runtime/RuntimePanel";

const EMPTY_MANIFEST: InteractionManifest = {
  schemaVersion: "blocky.interaction/v0-spike",
  entries: [],
};

const CANCELLED_EVENT: RuntimeEvent = {
  eventVersion: "blocky.event/v0-spike",
  runId: "run-1",
  sequence: 1,
  type: "run.cancelled",
  data: {},
};

const TOOL_EVENT: RuntimeEvent = {
  eventVersion: "blocky.event/v0-spike",
  runId: "run-2",
  sequence: 3,
  type: "tool.started",
  blockId: "tool-call",
  data: {},
};

function renderPanel(overrides: Partial<RuntimePanelProps> = {}) {
  return render(
    <RuntimePanel
      manifest={EMPTY_MANIFEST}
      activeEntryId={null}
      onActiveEntryIdChange={vi.fn()}
      onSubmit={vi.fn(async () => undefined)}
      submissions={[]}
      events={[]}
      blockTypes={{}}
      disabled
      running={false}
      pendingPermission={null}
      onCancel={vi.fn()}
      onApprovePermission={vi.fn()}
      onDenyPermission={vi.fn()}
      {...overrides}
    />,
  );
}

describe("RuntimePanel empty manifest", () => {
  it("centers the idle guidance in the flexible grid row with intended typography", () => {
    renderPanel();

    const guidance = screen.getByText("添加聊天入口后即可开始对话测试");
    const style = getComputedStyle(guidance);
    expect(document.styleSheets.length).toBeGreaterThan(0);
    expect(guidance).toHaveClass("runtime-panel__empty");
    expect(style.gridRow).toBe("1");
    expect(style.fontSize).toBe("14px");
    expect(style.lineHeight).toBe("1.55");
    expect(style.alignItems).toBe("center");
    expect(style.justifyContent).toBe("center");
    expect(screen.queryByText("执行过程"))
      .not.toBeInTheDocument();
  });

  it("keeps timeline, permission prompt, and cancellation reachable without a composer", () => {
    renderPanel({
      submissions: [{ runId: "run-1", entryId: "entry-1", userText: "请执行" }],
      events: [CANCELLED_EVENT],
      running: true,
      pendingPermission: {
        runId: "run-1",
        runToken: 1,
        projectionRevision: 2,
        projectionDigest: "digest-1",
        toolId: "tool.echo",
        callBlockId: "block-1",
        permissions: ["host.echo"],
      },
    });

    expect(screen.getByText("请执行")).toHaveClass("conversation-message--user");
    expect(screen.getByText("运行已取消，可修改后重试。")).toHaveClass(
      "conversation-message--assistant",
    );
    expect(screen.getByRole("alertdialog", { name: "工具权限请求" }))
      .toBeInTheDocument();
    expect(screen.getByRole("button", { name: "取消运行" })).toBeInTheDocument();
    expect(screen.queryByText("添加聊天入口后即可开始对话测试"))
      .not.toBeInTheDocument();
    expect(screen.queryByTestId("runtime-send")).not.toBeInTheDocument();
  });

  it("renders conversation messages with a collapsed friendly trace using the shared block colour", async () => {
    const user = userEvent.setup();
    const colouredProps = {
      submissions: [{
        runId: "run-2",
        entryId: "entry-1",
        userText: "明天上海天气怎么样？",
      }],
      events: [
        { ...TOOL_EVENT, sequence: 1, type: "run.started" as const, blockId: undefined },
        TOOL_EVENT,
        {
          eventVersion: "blocky.event/v0-spike" as const,
          runId: "run-2",
          sequence: 4,
          type: "model.chunk" as const,
          blockId: "tool-call",
          data: { text: "助手回复：明天上海晴朗。" },
        },
        {
          eventVersion: "blocky.event/v0-spike" as const,
          runId: "run-2",
          sequence: 5,
          type: "run.completed" as const,
          data: {},
        },
      ],
      blockTypes: { "tool-call": "core.tool.call" },
    } as Partial<RuntimePanelProps> & {
      blockTypes: Readonly<Record<string, string>>;
    };

    renderPanel(colouredProps);

    expect(screen.getByText("明天上海天气怎么样？")).toHaveClass(
      "conversation-message--user",
    );
    expect(screen.getByText("助手回复：明天上海晴朗。")).toHaveClass(
      "conversation-message--assistant",
    );
    const traceToggle = screen.getByRole("button", { name: "执行过程" });
    expect(traceToggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("调用工具")).not.toBeInTheDocument();
    expect(screen.queryByText("tool-call")).not.toBeInTheDocument();

    await user.click(traceToggle);
    const category = screen.getAllByText("工具")[0];
    const eventRow = category.closest(".conversation-trace__item");
    expect(eventRow).toHaveAttribute("data-category", "tools");
    expect(eventRow).toHaveStyle({ "--event-colour": "#ef6c00" });
  });
});
