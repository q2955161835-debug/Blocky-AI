// @vitest-environment jsdom
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { App } from "../../apps/studio-desktop/src/app/App";
import { ResizeHandle } from "../../apps/studio-desktop/src/app/ResizeHandle";
vi.mock("../../packages/ui-editor/src/index.ts", () => ({
  Canvas: () => <div>测试画布</div>,
}));
beforeAll(() => {
  window.PointerEvent = MouseEvent as typeof PointerEvent;
  HTMLElement.prototype.setPointerCapture = () => {};
  HTMLElement.prototype.releasePointerCapture = () => {};
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});

it("folds the entire blueprint area, including canvas navigation, under one heading", async () => {
  render(<App />);
  await waitFor(() => expect((screen.getByRole("button", {name:"新建空白项目"}) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", {name:"新建空白项目"}));
  await screen.findByLabelText("画布名称");
  const summary = screen.getByRole("button",{name:"蓝图"});
  const drawer = summary.closest("section");
  expect(drawer).toBeTruthy();
  expect(summary.getAttribute("aria-expanded")).toBe("false");
  expect(screen.queryByRole("button",{name:"新建：知识问答助手"})).toBeNull();
  fireEvent.click(summary);
  expect(summary.getAttribute("aria-expanded")).toBe("true");
  expect(within(drawer!).getByRole("button", {name:"新建：知识问答助手"})).toBeTruthy();
  expect(within(drawer!).getByRole("button", {name:"新建：Pi Agent"})).toBeTruthy();
  fireEvent.click(summary);
  expect(summary.getAttribute("aria-expanded")).toBe("false");
  expect(screen.getByText("项目画布").closest(".blueprint-dock-content")?.hasAttribute("hidden")).toBe(true);
});

it("resizes from the boundary with pointer and keyboard, respecting limits and ending capture", () => {
  const change = vi.fn();
  render(
    <ResizeHandle
      label="左栏宽度"
      axis="x"
      value={240}
      min={180}
      max={500}
      onChange={change}
    />,
  );
  const handle = screen.getByRole("separator", { name: "左栏宽度" });
  fireEvent.pointerDown(handle, { button: 0, clientX: 240, pointerId: 1 });
  fireEvent.pointerMove(handle, { clientX: 320, pointerId: 1 });
  expect(change).toHaveBeenLastCalledWith(320);
  fireEvent.pointerMove(handle, { clientX: 9999, pointerId: 1 });
  expect(change).toHaveBeenLastCalledWith(500);
  fireEvent.pointerUp(handle, { pointerId: 1 });
  change.mockClear();
  fireEvent.pointerMove(handle, { clientX: 400, pointerId: 1 });
  expect(change).not.toHaveBeenCalled();
  fireEvent.keyDown(handle, { key: "ArrowLeft" });
  expect(change).toHaveBeenLastCalledWith(230);
});

it("fully hides panels, keeps the assistant draft when switching views, and exposes named toolbar actions", async () => {
  render(<App />);
  await waitFor(() =>
    expect(
      (screen.getByRole("button", { name: "新建空白项目" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false),
  );
  fireEvent.click(screen.getByRole("button", { name: "新建空白项目" }));
  await screen.findByLabelText("画布名称");
  const toolbar = screen.getByRole("banner");
  expect(
    within(toolbar).getByRole("button", { name: "保存项目" }).title,
  ).toContain("保存项目");
  expect(screen.queryByRole("region", { name: "底部面板" })).toBeNull();
  fireEvent.click(
    within(toolbar).getByRole("button", { name: "显示底部面板" }),
  );
  expect(screen.getByRole("region", { name: "底部面板" })).toBeTruthy();
  fireEvent.click(
    within(toolbar).getByRole("button", { name: "隐藏底部面板" }),
  );
  expect(screen.queryByRole("region", { name: "底部面板" })).toBeNull();
  fireEvent.click(screen.getByRole("tab", { name: "构建助手" }));
  fireEvent.change(screen.getByLabelText("构建需求"), {
    target: { value: "帮我讲解这些积木" },
  });
  fireEvent.click(screen.getByRole("tab", { name: "Blocky Agent" }));
  fireEvent.click(
    within(toolbar).getByRole("button", { name: "隐藏右侧面板" }),
  );
  expect(screen.queryByRole("tab", { name: "Blocky Agent" })).toBeNull();
  fireEvent.click(
    within(toolbar).getByRole("button", { name: "显示右侧面板" }),
  );
  fireEvent.click(screen.getByRole("tab", { name: "构建助手" }));
  expect((screen.getByLabelText("构建需求") as HTMLTextAreaElement).value).toBe(
    "帮我讲解这些积木",
  );
  expect(screen.queryByRole("dialog", { name: "Blocky 构建助手" })).toBeNull();
  await waitFor(() =>
    expect(
      (screen.getByRole("button", { name: "发送" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false),
  );
  fireEvent.click(screen.getByRole("button", { name: "发送" }));
  expect(screen.getByRole("dialog", {name:"设置"})).toBeTruthy();
  expect(screen.getByRole("navigation", {name:"设置分类"}).querySelector('[aria-current="page"]')?.textContent).toBe("构建助手");
  expect((screen.getByLabelText("构建需求") as HTMLTextAreaElement).value).toBe("帮我讲解这些积木");
});
