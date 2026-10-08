// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { MenuBar } from "../../apps/studio-desktop/src/app/MenuBar";
afterEach(cleanup);
it("retains seven text menus and their keyboard and pointer entry points", () => {
  const open = vi.fn();
  render(
    <MenuBar
      active={null}
      open={open}
      enabled={() => true}
      execute={vi.fn()}
      disabled={false}
    />,
  );
  const bar = screen.getByRole("menubar", { name: "应用菜单" });
  for (const name of ["文件", "编辑", "视图", "运行", "构建", "终端", "帮助"]) {
    const button = within(bar).getByRole("menuitem", { name });
    expect(button.textContent).toBe(name);
    expect(button.querySelector("svg")).toBeNull();
  }
  fireEvent.click(within(bar).getByRole("menuitem", { name: "文件" }));
  expect(open).toHaveBeenCalledWith("file");
  fireEvent.keyDown(within(bar).getByRole("menuitem", { name: "构建" }), {
    key: "ArrowDown",
  });
  expect(open).toHaveBeenCalledWith("build");
});
