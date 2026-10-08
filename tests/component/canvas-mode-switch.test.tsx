// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CanvasModeSwitch } from "../../packages/ui-editor/src/canvas/CanvasModeSwitch";

afterEach(cleanup);

it("names both icon modes and displays the controlled selected mode", () => {
  const onChange = vi.fn();
  const view = render(<CanvasModeSwitch mode="default" onChange={onChange} />);
  expect(screen.getByRole("button", { name: "默认鼠标模式" }).getAttribute("aria-pressed")).toBe("true");
  expect(screen.getByRole("button", { name: "纯拖拽模式" }).getAttribute("aria-pressed")).toBe("false");
  fireEvent.click(screen.getByRole("button", { name: "纯拖拽模式" }));
  expect(onChange).toHaveBeenCalledExactlyOnceWith("pan");
  view.rerender(<CanvasModeSwitch mode="pan" onChange={onChange} panning />);
  expect(screen.getByRole("button", { name: "纯拖拽模式" }).getAttribute("aria-pressed")).toBe("true");
  expect(screen.getByRole("group", { name: "画布操作模式" }).getAttribute("data-panning")).toBe("true");
});

it("supports Tab and Space without leaking pointer starts or clicks to the canvas", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  const onPointerDown = vi.fn();
  const onMouseDown = vi.fn();
  const onClick = vi.fn();
  render(<div onPointerDown={onPointerDown} onMouseDown={onMouseDown} onClick={onClick}><CanvasModeSwitch mode="default" onChange={onChange} /></div>);
  await user.tab();
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "默认鼠标模式" }));
  await user.tab();
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "纯拖拽模式" }));
  await user.keyboard(" ");
  expect(onChange).toHaveBeenCalledWith("pan");
  fireEvent.pointerDown(screen.getByRole("button", { name: "默认鼠标模式" }));
  fireEvent.mouseDown(screen.getByRole("button", { name: "默认鼠标模式" }));
  await user.click(screen.getByRole("button", { name: "默认鼠标模式" }));
  expect(onChange).toHaveBeenLastCalledWith("default");
  expect(onPointerDown).not.toHaveBeenCalled();
  expect(onMouseDown).not.toHaveBeenCalled();
  expect(onClick).not.toHaveBeenCalled();
  expect(screen.getByRole("group", { name: "画布操作模式" }).hasAttribute("data-canvas-controls")).toBe(true);
});
