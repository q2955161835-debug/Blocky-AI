// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SettingsShell } from "../../apps/studio-desktop/src/app/settings/SettingsShell";
import { SettingsGroup, SettingsRow } from "../../apps/studio-desktop/src/app/settings/SettingsRow";
import { settingsSections } from "../../apps/studio-desktop/src/app/settings/settingsNavigation";

afterEach(cleanup);

it("exposes all Blocky categories and tracks the controlled current section", () => {
  const onSection = vi.fn();
  const view = render(<SettingsShell section="general" onSection={onSection} query="" onQuery={vi.fn()}><p>常规内容</p></SettingsShell>);
  const navigation = screen.getByRole("navigation", { name: "设置分类" });
  expect(within(navigation).getAllByRole("button").map((button) => button.textContent)).toEqual(settingsSections.map((section) => section.title));
  expect(within(navigation).getByRole("button", { name: "常规" }).getAttribute("aria-current")).toBe("page");
  fireEvent.click(within(navigation).getByRole("button", { name: "模型与厂商" }));
  expect(onSection).toHaveBeenCalledExactlyOnceWith("models");
  view.rerender(<SettingsShell section="models" onSection={onSection} query="" onQuery={vi.fn()}><p>模型内容</p></SettingsShell>);
  expect(screen.getByRole("region", { name: "模型与厂商" })).toBeTruthy();
  expect(within(navigation).getByRole("button", { name: "模型与厂商" }).getAttribute("aria-current")).toBe("page");
  expect(within(navigation).getByRole("button", { name: "常规" }).hasAttribute("aria-current")).toBe(false);
});

it("keeps search text controlled and reports user edits without altering navigation", () => {
  const onQuery = vi.fn();
  const view = render(<SettingsShell section="appearance" onSection={vi.fn()} query="主题" onQuery={onQuery}><p>外观内容</p></SettingsShell>);
  const input = screen.getByRole("searchbox", { name: "搜索设置" }) as HTMLInputElement;
  input.focus();
  fireEvent.change(input, { target: { value: "深色" } });
  expect(onQuery).toHaveBeenCalledExactlyOnceWith("深色");
  view.rerender(<SettingsShell section="appearance" onSection={vi.fn()} query="深色" onQuery={onQuery}><p>外观内容</p></SettingsShell>);
  expect(input.value).toBe("深色");
  expect(document.activeElement).toBe(input);
  expect(within(screen.getByRole("navigation")).getAllByRole("button")).toHaveLength(7);
});

it("lets keyboard users navigate categories and close settings without duplicate close controls", async () => {
  const user = userEvent.setup();
  const onSection = vi.fn();
  const onClose = vi.fn();
  const view = render(<SettingsShell section="general" onSection={onSection} query="" onQuery={vi.fn()} onClose={onClose}><p>内容</p></SettingsShell>);
  screen.getByRole("button", { name: "快捷键" }).focus();
  await user.keyboard("{Enter}");
  expect(onSection).toHaveBeenCalledWith("shortcuts");
  screen.getByRole("button", { name: "关闭设置" }).focus();
  await user.keyboard(" ");
  expect(onClose).toHaveBeenCalledOnce();
  view.rerender(<SettingsShell section="general" onSection={onSection} query="" onQuery={vi.fn()}><p>内容</p></SettingsShell>);
  expect(screen.queryByRole("button", { name: "关闭设置" })).toBeNull();
});

it("provides a labelled category disclosure without losing the selected section or content", () => {
  render(<SettingsShell section="agent" onSection={vi.fn()} query="" onQuery={vi.fn()}><p>保留运行设置</p></SettingsShell>);
  const toggle = screen.getByRole("button", { name: "收起分类" });
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  expect(document.getElementById(toggle.getAttribute("aria-controls")!)).toBe(screen.getByRole("navigation"));
  fireEvent.click(toggle);
  expect(screen.getByRole("button", { name: "展开分类" }).getAttribute("aria-expanded")).toBe("false");
  expect(screen.getByText("保留运行设置")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "展开分类" }));
  expect(screen.getByRole("button", { name: "收起分类" }).getAttribute("aria-expanded")).toBe("true");
  expect(screen.getByRole("button", { name: "作品运行" }).getAttribute("aria-current")).toBe("page");
});

it("groups descriptive settings while retaining explicit accessible names on their controls", () => {
  render(<SettingsGroup title="显示"><SettingsRow title="主题" description="选择应用外观"><select aria-label="应用主题"><option>深色</option></select></SettingsRow><SettingsRow title="减少动态"><input aria-label="减少动态" type="checkbox" /></SettingsRow></SettingsGroup>);
  expect(screen.getByRole("region", { name: "显示" })).toBeTruthy();
  const row = screen.getByRole("group", { name: "主题" });
  expect(document.getElementById(row.getAttribute("aria-describedby")!)?.textContent).toBe("选择应用外观");
  expect(within(row).getByRole("combobox", { name: "应用主题" })).toBeTruthy();
  expect(screen.getByRole("group", { name: "减少动态" }).hasAttribute("aria-describedby")).toBe(false);
  expect(screen.getByRole("checkbox", { name: "减少动态" })).toBeTruthy();
});
