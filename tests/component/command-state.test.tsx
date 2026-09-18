// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { App } from "../../apps/studio-desktop/src/app/App";
const io = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock("../../packages/ui-editor/src/index.ts", () => ({
  Canvas: () => null,
}));
vi.mock("../../apps/studio-desktop/src/composition/host", () => ({
  openProject: vi.fn(),
  saveProject: io.save,
  readPreferences: () => ({
    reduceMotion: false,
    view: "professional",
    minimizeToTray: true,
  }),
  writePreferences: vi.fn(),
}));
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.clearAllMocks();
});
it("opens an anchored file menu, switches menus, and keeps the command center separate", async () => {
  render(<App />);
  const file = screen.getByRole("menuitem", { name: "文件" });
  fireEvent.click(file);
  const menu = screen.getByRole("menu", { name: "文件" });
  expect(file.getAttribute("aria-expanded")).toBe("true");
  expect(screen.queryByRole("dialog", { name: "命令中心" })).toBeNull();
  expect(within(menu).getByRole("menuitem", { name: /保存项目/ })).toBeTruthy();
  fireEvent.keyDown(menu, { key: "ArrowRight" });
  const editMenu = screen.getByRole("menu", { name: "编辑" });
  expect(
    (
      within(editMenu).getByRole("menuitem", {
        name: /^撤销/,
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  fireEvent.keyDown(editMenu, { key: "Escape" });
  expect(screen.queryByRole("menu")).toBeNull();
  expect(document.activeElement).toBe(
    screen.getByRole("menuitem", { name: "编辑" }),
  );
  fireEvent.click(file);
  fireEvent.pointerDown(document.body);
  expect(screen.queryByRole("menu")).toBeNull();
  fireEvent.click(file);
  fireEvent.click(screen.getByRole("button", { name: /搜索命令/ }));
  expect(screen.queryByRole("menu")).toBeNull();
  expect(screen.getByRole("dialog", { name: "命令中心" })).toBeTruthy();
});
it("executes menu commands through the same project actions", async () => {
  render(<App />);
  fireEvent.click(screen.getByRole("menuitem", { name: "文件" }));
  const menu = screen.getByRole("menu", { name: "文件" });
  fireEvent.keyDown(menu, { key: "ArrowDown" });
  expect(document.activeElement).toBe(
    within(menu).getByRole("menuitem", { name: /打开项目/ }),
  );
  fireEvent.click(within(menu).getByRole("menuitem", { name: /新建项目/ }));
  expect(screen.queryByRole("menu")).toBeNull();
  expect(await screen.findByLabelText("画布名称")).toBeTruthy();
});
it("disables both runtime controls while saving and restores them after cancellation", async () => {
  let finish!: (value: null) => void;
  io.save.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "＋ 新建项目" }));
  await waitFor(() =>
    expect(
      screen
        .getAllByRole("button", { name: "▶ 运行" })
        .every((b) => !(b as HTMLButtonElement).disabled),
    ).toBe(true),
  );
  fireEvent.click(screen.getByRole("button", { name: "保存" }));
  expect(
    screen
      .getAllByRole("button", { name: "▶ 运行" })
      .every((b) => (b as HTMLButtonElement).disabled),
  ).toBe(true);
  await act(async () => {
    finish(null);
  });
  expect(
    screen
      .getAllByRole("button", { name: "▶ 运行" })
      .every((b) => !(b as HTMLButtonElement).disabled),
  ).toBe(true);
});
