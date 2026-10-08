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
import { useStudio } from "../../apps/studio-desktop/src/composition/useStudio";
import { SettingsPanel } from "../../apps/studio-desktop/src/app/SettingsPanel";
import { StudioDialog } from "../../apps/studio-desktop/src/app/StudioDialog";
import type { Studio } from "../../apps/studio-desktop/src/composition/useStudio";
let studio: Studio;
afterEach(async () => {
  cleanup();
  await studio?.settings.flush().catch(() => {});
  await studio?.resources.flush().catch(() => {});
  localStorage.clear();
  vi.restoreAllMocks();
});
function Harness({
  initial = "general",
}: {
  initial?: "general" | "appearance" | "models" | "builder";
}) {
  studio = useStudio();
  return <SettingsPanel studio={studio} initialSection={initial} />;
}
it("searches all categories and persists actual theme and font choices", async () => {
  render(<Harness />);
  await waitFor(() => expect(studio.settings.ui.ready).toBe(true));
  fireEvent.change(screen.getByRole("searchbox", { name: "搜索设置" }), {
    target: { value: "代码字体" },
  });
  fireEvent.click(
    within(screen.getByLabelText("设置搜索结果")).getByRole("button", {
      name: /外观/,
    }),
  );
  fireEvent.change(screen.getByLabelText("应用主题"), {
    target: { value: "light" },
  });
  fireEvent.change(screen.getByRole("combobox", { name: "界面字体" }), {
    target: { value: "simsun" },
  });
  fireEvent.change(screen.getByRole("combobox", { name: "代码字体" }), {
    target: { value: "courier" },
  });
  await act(() => studio.settings.flush());
  expect(document.documentElement.dataset.theme).toBe("light");
  expect(
    document.documentElement.style.getPropertyValue("--ui-font"),
  ).toContain("SimSun");
  expect(
    document.documentElement.style.getPropertyValue("--code-font"),
  ).toContain("Courier");
  expect(
    JSON.parse(localStorage.getItem("blocky.ui-preferences.app")!).values,
  ).toMatchObject({
    theme: "light",
    fontFamily: "simsun",
    codeFont: "courier",
  });
});
it("keeps incomplete connection drafts when switching categories and protects closing", async () => {
  const close = vi.fn();
  function Dialog() {
    studio = useStudio();
    return (
      <StudioDialog
        studio={studio}
        popup={{ kind: "resources" }}
        setPopup={close}
        query=""
        setQuery={vi.fn()}
        actions={{}}
        enabled={() => true}
        execute={vi.fn()}
        add={vi.fn()}
      />
    );
  }
  render(<Dialog />);
  await waitFor(() => expect(studio.resources.ready).toBe(true));
  expect(
    within(screen.getByRole("navigation"))
      .getByRole("button", { name: "模型与厂商" })
      .getAttribute("aria-current"),
  ).toBe("page");
  fireEvent.click(screen.getByRole("button", { name: "添加厂商" }));
  fireEvent.change(screen.getByLabelText("厂商名称"), {
    target: { value: "未完成连接" },
  });
  fireEvent.click(
    within(screen.getByRole("navigation")).getByRole("button", {
      name: "外观",
    }),
  );
  fireEvent.click(
    within(screen.getByRole("navigation")).getByRole("button", {
      name: "模型与厂商",
    }),
  );
  expect((screen.getByLabelText("厂商名称") as HTMLInputElement).value).toBe(
    "未完成连接",
  );
  fireEvent.click(screen.getByRole("button", { name: "关闭设置" }));
  expect(close).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "返回编辑" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "返回编辑" }));
  expect((screen.getByLabelText("厂商名称") as HTMLInputElement).value).toBe(
    "未完成连接",
  );
});
it("automatically saves valid existing provider edits and retains the editor", async () => {
  localStorage.setItem(
    "blocky.resources.app",
    JSON.stringify({
      schemaVersion: "blocky.resource-registry/v2",
      revision: 1,
      resources: [],
      providers: [
        {
          schemaVersion: "blocky.model-provider/v1",
          providerId: "provider-test",
          displayName: "本地测试连接",
          adapter: "xirang",
          protocol: "openai-chat",
          revision: 1,
          secretBindings: [{ fieldId: "apiKey", secretRef: "secret-test" }],
        },
      ],
    }),
  );
  render(<Harness initial="models" />);
  await waitFor(() => expect(studio.resources.ready).toBe(true));
  fireEvent.click(
    screen.getByRole("button", { name: "编辑厂商 本地测试连接" }),
  );
  fireEvent.change(screen.getByLabelText("厂商名称"), {
    target: { value: "更新后的连接" },
  });
  await waitFor(
    () =>
      expect(studio.resources.registry.providers[0].displayName).toBe(
        "更新后的连接",
      ),
    { timeout: 3000 },
  );
  expect((screen.getByLabelText("厂商名称") as HTMLInputElement).value).toBe(
    "更新后的连接",
  );
  fireEvent.change(screen.getByLabelText("厂商名称"), {
    target: { value: "再次更新" },
  });
  await waitFor(
    () =>
      expect(studio.resources.registry.providers[0].displayName).toBe(
        "再次更新",
      ),
    { timeout: 3000 },
  );
  expect(studio.resources.registry.providers[0].revision).toBe(3);
});
