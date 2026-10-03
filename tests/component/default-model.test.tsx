// @vitest-environment jsdom
import { afterEach, beforeAll, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { useStudio } from "../../apps/studio-desktop/src/composition/useStudio";
import { useCodingAgent } from "../../apps/studio-desktop/src/composition/useCodingAgent";
import { BuilderPanel } from "../../apps/studio-desktop/src/app/BuilderPanel";
import { SettingsPanel } from "../../apps/studio-desktop/src/app/SettingsPanel";
import { createAgentExample } from "../../packages/test-fixtures/src/scenarios";
import { modelResource } from "../fixtures/model-resource";

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
});

afterEach(() => { cleanup(); localStorage.clear(); });

async function configuredStudio() {
  const hook = renderHook(() => useStudio());
  await waitFor(() => expect(hook.result.current.settings.ready && hook.result.current.resources.ready).toBe(true));
  await act(() => hook.result.current.resources.upsert({...modelResource(),definition:{...modelResource().definition,capabilities:["text","tools"]}}));
  await act(() => hook.result.current.resources.flush());
  act(() => hook.result.current.settings.change("app", "models.defaultResourceId", "saved-model"));
  await act(() => hook.result.current.settings.flush());
  return hook;
}

it("reopens the coding assistant with the persisted model and no simulated mode", async () => {
  let hook = await configuredStudio();
  hook.unmount();
  hook = renderHook(() => useStudio());
  await waitFor(() => expect(hook.result.current.settings.ready && hook.result.current.resources.ready).toBe(true));
  const builder = renderHook(() => useCodingAgent(hook.result.current));
  await waitFor(() => expect(builder.result.current.ready).toBe(true));
  const props = { studio: hook.result.current, builder: builder.result.current, configureModel() {} };
  const dialog = render(<BuilderPanel {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "构建助手设置" }));
  expect(screen.queryByLabelText("构建模型模式")).toBeNull();
  expect((screen.getByLabelText("构建模型资源") as HTMLSelectElement).value).toBe("saved-model");

  dialog.unmount();
  render(<BuilderPanel {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "构建助手设置" }));
  expect((screen.getByLabelText("构建模型资源") as HTMLSelectElement).value).toBe("saved-model");
});

it("keeps new projects empty and preserves the model choice in existing projects", async () => {
  const hook = await configuredStudio();
  const existing = createAgentExample("existing-project");
  act(() => hook.result.current.controller.replace(existing));
  expect(hook.result.current.snapshot.project).toEqual(existing);
  await act(() => hook.result.current.fresh());
  await waitFor(() => expect(hook.result.current.compiling).toBe(false));
  const project = hook.result.current.snapshot.project;
  expect(project.manifest.resources).toEqual([]);
  expect(project.resources).toEqual({});
  expect(project.workspaces.main.blocks.blocks).toEqual([]);
  expect(Object.values(existing.workspaces).flatMap(w => w.blocks.blocks).length).toBeGreaterThan(0);
  expect(project.settings?.values["models.defaultResourceId"]).toBeUndefined();
  expect(hook.result.current.compiled?.diagnostics.filter(d => d.severity === "error")).toEqual([]);
});

it("shows a missing default and prevents an implicit switch to another online model", async () => {
  const hook = await configuredStudio();
  await act(() => hook.result.current.resources.remove("saved-model"));
  await act(() => hook.result.current.resources.flush());
  const builder = renderHook(() => useCodingAgent(hook.result.current));
  await waitFor(() => expect(builder.result.current.ready).toBe(true));
  render(<BuilderPanel studio={hook.result.current} builder={builder.result.current} configureModel={() => {}} />);
  fireEvent.change(screen.getByLabelText("构建需求"), { target: { value: "Explain the selected blocks" } });
  await waitFor(() => expect((screen.getByRole("button", { name: "发送" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "发送" }));
  expect(screen.getByRole("dialog", {name:"构建助手设置"}).textContent).toContain("默认模型不可用");
  expect((screen.getByLabelText("构建需求") as HTMLTextAreaElement).value).toBe("Explain the selected blocks");
});

it("offers configured user models in settings and resets the preference to local defaults", async () => {
  const hook = await configuredStudio();
  const panel = render(<SettingsPanel studio={hook.result.current} />);
  expect((screen.getByLabelText("默认模型") as HTMLSelectElement).value).toBe("saved-model");
  fireEvent.change(screen.getByLabelText("默认模型"), { target: { value: "" } });
  await act(() => hook.result.current.settings.flush());
  panel.rerender(<SettingsPanel studio={hook.result.current} />);
  expect((screen.getByLabelText("默认模型") as HTMLSelectElement).value).toBe("");
});
