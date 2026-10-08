// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { WindowControls } from "../../apps/studio-desktop/src/app/WindowControls";

const native = vi.hoisted(() => ({
  enabled: true,
  maximized: false,
  resize: undefined as (() => void) | undefined,
  minimize: vi.fn(async () => {}),
  toggleMaximize: vi.fn(async () => { native.maximized = !native.maximized; }),
  close: vi.fn(async () => {}),
  dispose: vi.fn(),
  setTitle: vi.fn(async (_title: string) => {}),
}));
vi.mock("../../apps/studio-desktop/node_modules/@tauri-apps/api/core", () => ({ isTauri: () => native.enabled }));
vi.mock("../../apps/studio-desktop/node_modules/@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({
  minimize: native.minimize,
  toggleMaximize: native.toggleMaximize,
  close: native.close,
  setTitle: native.setTitle,
  isMaximized: async () => native.maximized,
  onResized: async (callback: () => void) => { native.resize = callback; return native.dispose; },
}) }));
afterEach(() => { cleanup(); native.enabled = true; native.maximized = false; vi.clearAllMocks(); });

it("names independent windows after their current work", async () => {
  const view = render(<WindowControls onError={vi.fn()} projectTitle="刑法条文问答" />);
  await waitFor(() => expect(native.setTitle).toHaveBeenLastCalledWith("刑法条文问答 — Blocky Studio"));
  view.rerender(<WindowControls onError={vi.fn()} projectTitle="CPI工作助手" />);
  await waitFor(() => expect(native.setTitle).toHaveBeenLastCalledWith("CPI工作助手 — Blocky Studio"));
});

it("uses the native window lifecycle for controls and follows maximize state", async () => {
  render(<WindowControls onError={vi.fn()} />);
  await waitFor(() => expect(native.resize).toBeTypeOf("function"));
  fireEvent.click(screen.getByRole("button", { name: "最小化窗口" }));
  await waitFor(() => expect(native.minimize).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole("button", { name: "最大化窗口" }));
  await screen.findByRole("button", { name: "还原窗口" });
  native.maximized = false;
  native.resize!();
  await screen.findByRole("button", { name: "最大化窗口" });
  fireEvent.click(screen.getByRole("button", { name: "关闭窗口" }));
  await waitFor(() => expect(native.close).toHaveBeenCalledOnce());
  cleanup();
  expect(native.dispose).toHaveBeenCalledOnce();
});

it("reports a failed native action and keeps controls usable", async () => {
  const onError = vi.fn();
  native.minimize.mockRejectedValueOnce(Error("window unavailable"));
  render(<WindowControls onError={onError} />);
  fireEvent.click(screen.getByRole("button", { name: "最小化窗口" }));
  await waitFor(() => expect(onError).toHaveBeenCalledWith("窗口操作未能完成，请重试。"));
  expect((screen.getByRole("button", { name: "关闭窗口" }) as HTMLButtonElement).disabled).toBe(false);
});

it("does not add desktop controls to browser previews", () => {
  native.enabled = false;
  render(<WindowControls onError={vi.fn()} />);
  expect(screen.queryByRole("group", { name: "窗口控制" })).toBeNull();
});
