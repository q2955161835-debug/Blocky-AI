import { render, screen } from "@testing-library/react";
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

function renderPanel(overrides: Partial<RuntimePanelProps> = {}) {
  return render(
    <RuntimePanel
      manifest={EMPTY_MANIFEST}
      activeEntryId={null}
      onActiveEntryIdChange={vi.fn()}
      onSubmit={vi.fn(async () => undefined)}
      events={[]}
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

    const guidance = screen.getByText("添加聊天入口后才能运行作品");
    const style = getComputedStyle(guidance);
    expect(document.styleSheets.length).toBeGreaterThan(0);
    expect(guidance).toHaveClass("runtime-panel__empty");
    expect(style.gridRow).toBe("1");
    expect(style.fontSize).toBe("14px");
    expect(style.lineHeight).toBe("1.55");
    expect(style.alignItems).toBe("center");
    expect(style.justifyContent).toBe("center");
    expect(screen.queryByRole("heading", { name: "事件时间线" }))
      .not.toBeInTheDocument();
  });

  it("keeps timeline, permission prompt, and cancellation reachable without a composer", () => {
    renderPanel({
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

    expect(screen.getByRole("heading", { name: "事件时间线" })).toBeInTheDocument();
    const eventType = screen.getByText("run.cancelled");
    const eventRow = eventType.closest(".event-timeline__item");
    expect(eventRow).toHaveAttribute("data-event-version", "blocky.event/v0-spike");
    expect(eventRow).toHaveAttribute("data-run-id", "run-1");
    expect(screen.getByRole("alertdialog", { name: "工具权限请求" }))
      .toBeInTheDocument();
    expect(screen.getByRole("button", { name: "取消运行" })).toBeInTheDocument();
    expect(screen.queryByText("添加聊天入口后才能运行作品"))
      .not.toBeInTheDocument();
    expect(screen.queryByTestId("runtime-send")).not.toBeInTheDocument();
  });
});
