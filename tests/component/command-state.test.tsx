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
  Canvas: ({ onContext, onSelect }: {
    onContext: (x: number, y: number, scope: "block", blockId: string) => void;
    onSelect: (id: string | null) => void;
  }) => <button onClick={() => {
    onContext(400, 280, "block", "research-root");
    onSelect(null); // Dialog focus can clear Blockly selection after the context target is captured.
  }}>测试积木右键</button>,
}));
vi.mock("../../apps/studio-desktop/src/composition/host", () => ({
  openProject: vi.fn(async () => ({
    project: (await import("../../packages/test-fixtures/src")).createStarter(), handle: "test-existing",
  })),
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
it("runs from the Agent editor on F5 and consumes the browser reload shortcut", async () => {
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "打开本机项目" }));
  const input = await screen.findByLabelText("向 Agent 提问");
  await waitFor(() => expect(screen.getAllByRole("button", { name: "运行", exact: true }).every(b => !(b as HTMLButtonElement).disabled)).toBe(true));
  fireEvent.change(input, { target: { value: "快捷键运行" } });
  const key = new KeyboardEvent("keydown", { key: "F5", bubbles: true, cancelable: true });
  act(() => input.dispatchEvent(key));
  expect(key.defaultPrevented).toBe(true);
  await waitFor(() => expect(screen.getByLabelText("Blocky Agent 聊天记录").textContent).toContain("快捷键运行"));
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
  await waitFor(() => expect((screen.getByRole("button", { name: "新建空白项目" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole("menuitem", { name: "文件" }));
  const menu = screen.getByRole("menu", { name: "文件" });
  fireEvent.keyDown(menu, { key: "ArrowDown" });
  expect(document.activeElement).toBe(
    within(menu).getByRole("menuitem", { name: /打开项目/ }),
  );
  await waitFor(() => expect((within(menu).getByRole("menuitem", { name: /新建项目/ }) as HTMLButtonElement).disabled).toBe(false));
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
  await waitFor(() => expect((screen.getByRole("button", { name: "新建空白项目" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "打开本机项目" }));
  await waitFor(() =>
    expect(
      screen
        .getAllByRole("button", { name: /^(▶ )?运行$/ })
        .every((b) => !(b as HTMLButtonElement).disabled),
    ).toBe(true),
  );
  fireEvent.click(screen.getByRole("button", { name: "保存项目" }));
  expect(
    screen
      .getAllByRole("button", { name: /^(▶ )?运行$/ })
      .every((b) => (b as HTMLButtonElement).disabled),
  ).toBe(true);
  await act(async () => {
    finish(null);
  });
  expect(
    screen
      .getAllByRole("button", { name: /^(▶ )?运行$/ })
      .every((b) => !(b as HTMLButtonElement).disabled),
  ).toBe(true);
});

it("keeps the context block target when opening the menu clears canvas focus", async () => {
  render(<App />);
  await waitFor(() => expect((screen.getByRole("button", { name: "新建空白项目" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "打开本机项目" }));
  await waitFor(() => expect((screen.getAllByRole("button", { name: /^(▶ )?运行$/ })[0] as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "测试积木右键" }));
  const dialog = screen.getByRole("dialog", { name: "上下文菜单" });
  await waitFor(() => expect((within(dialog).getByRole("button", { name: /从所选积木运行/ }) as HTMLButtonElement).disabled).toBe(false));
  expect((within(dialog).getByRole("button", { name: /切换断点/ }) as HTMLButtonElement).disabled).toBe(false);
});
