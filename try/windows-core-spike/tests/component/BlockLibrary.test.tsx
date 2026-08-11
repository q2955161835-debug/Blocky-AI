import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  BlockLibrary,
  type BlockInsertRequest,
  type BlockPointerDragStart,
} from "../../src/blockly/BlockLibrary";

describe("BlockLibrary", () => {
  it("separates six categories from authentic Blockly previews", async () => {
    const onInsert = vi.fn<(request: BlockInsertRequest) => void>();
    const view = render(
      <BlockLibrary
        selectedCategoryId="agents"
        onSelectedCategoryIdChange={vi.fn()}
        onInsert={onInsert}
      />,
    );

    const categoryNavigation = screen.getByRole("navigation", {
      name: "积木分类",
    });
    expect(categoryNavigation).toBeInTheDocument();
    expect(within(categoryNavigation).getAllByRole("button")).toHaveLength(6);
    await waitFor(() => {
      expect(view.container.querySelectorAll(".block-preview .blocklySvg"))
        .toHaveLength(2);
    });
    expect(view.container.querySelector(".block-preview--fake-card")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: /智能体.*成员/ }));
    expect(onInsert).toHaveBeenCalledWith({ blockType: "core.agent.define" });
  });

  it("searches registered labels and begins a typed pointer drag session", async () => {
    const user = userEvent.setup();
    const onPointerDragStart = vi.fn<(request: BlockPointerDragStart) => void>();
    render(
      <BlockLibrary
        selectedCategoryId="agents"
        onSelectedCategoryIdChange={vi.fn()}
        onInsert={vi.fn()}
        onPointerDragStart={onPointerDragStart}
      />,
    );

    await user.type(screen.getByRole("searchbox", { name: "搜索全部积木" }), "调用工具");
    const toolBlock = await screen.findByRole("button", { name: /调用工具/ });
    fireEvent.pointerDown(toolBlock, {
      pointerId: 7,
      clientX: 120,
      clientY: 240,
    });

    expect(onPointerDragStart).toHaveBeenCalledWith({
      blockType: "core.tool.call",
      pointerId: 7,
      clientPoint: { clientX: 120, clientY: 240 },
    });
    expect(toolBlock).not.toHaveAttribute("draggable");
  });

  it("keeps click insertion but suppresses the click following a real drag", async () => {
    const onInsert = vi.fn<(request: BlockInsertRequest) => void>();
    render(
      <BlockLibrary
        selectedCategoryId="agents"
        onSelectedCategoryIdChange={vi.fn()}
        onInsert={onInsert}
        onPointerDragStart={vi.fn()}
      />,
    );
    const block = await screen.findByRole("button", { name: /智能体.*成员/ });

    fireEvent.pointerDown(block, { pointerId: 3, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(window, { pointerId: 3, clientX: 10, clientY: 10 });
    fireEvent.click(block);
    expect(onInsert).toHaveBeenCalledTimes(1);

    fireEvent.pointerDown(block, { pointerId: 4, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(window, { pointerId: 4, clientX: 40, clientY: 40 });
    fireEvent.pointerUp(window, { pointerId: 4, clientX: 40, clientY: 40 });
    fireEvent.click(block);
    expect(onInsert).toHaveBeenCalledTimes(1);
  });
});
