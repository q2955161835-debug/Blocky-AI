// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
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
