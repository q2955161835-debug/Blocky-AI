import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CanvasControls } from "../../src/app/CanvasControls";
import { CanvasToolControls } from "../../src/blockly/CanvasToolControls";

describe("canvas controls", () => {
  it("keeps file and zoom actions without a separate Run action", () => {
    render(
      <CanvasControls
        zoomPercent={90}
        onSave={vi.fn()}
        onZoomOut={vi.fn()}
        onZoomIn={vi.fn()}
        onFit={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "保存项目" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "缩小画布" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /运行/ })).not.toBeInTheDocument();
  });

  it("switches between familiar select and hand tools with visible state", async () => {
    const user = userEvent.setup();
    const onToolChange = vi.fn();
    render(<CanvasToolControls tool="select" onToolChange={onToolChange} />);

    expect(screen.getByRole("button", { name: "选择工具 (V)" }))
      .toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "平移工具 (H)" }))
      .toHaveAttribute("aria-pressed", "false");
    await user.click(screen.getByRole("button", { name: "平移工具 (H)" }));
    expect(onToolChange).toHaveBeenCalledWith("pan");
  });
});
