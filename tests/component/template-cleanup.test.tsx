// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useStudio } from "../../apps/studio-desktop/src/composition/useStudio";
import { openProject } from "../../apps/studio-desktop/src/composition/host";
import { Welcome } from "../../apps/studio-desktop/src/app/Welcome";
import { Library } from "../../apps/studio-desktop/src/app/Library";
import { createSettings, updateSetting } from "../../packages/settings-core/src";
import { emptyRegistry, upsertUserResource } from "../../packages/resource-registry/src";
import { walkBlocks } from "../../packages/block-catalog/src/index";
import { createStartingBlueprint as createStartingBlueprintForTest } from "../../packages/block-catalog/src/starting-blueprints";
import type { Resource } from "../../packages/language-schema/src";

vi.mock("../../apps/studio-desktop/src/composition/host", () => ({
  openProject: vi.fn(),
  saveProject: vi.fn(),
  readPreferences: () => ({ reduceMotion: false, view: "professional", minimizeToTray: true }),
  writePreferences: vi.fn(),
}));
afterEach(() => { cleanup(); localStorage.clear(); });

it("offers the four official starting blueprints in order and keeps blank creation", async () => {
  const hook = renderHook(() => useStudio());
  await waitFor(() => expect(hook.result.current.compiling).toBe(false));
  render(<Welcome studio={hook.result.current} />);
  expect(screen.getAllByRole("button", { name: /从.*开始/ }).map((button) => button.getAttribute("aria-label"))).toEqual([
    "从知识问答助手开始",
    "从工作助手开始",
    "从Coding 助手开始",
    "从Pi Agent开始",
  ]);
  expect(screen.getByRole("button", { name: "新建空白项目" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "新建空白项目" }));
  await waitFor(() => expect(hook.result.current.started).toBe(true));
  const project = hook.result.current.snapshot.project;
  expect(project.manifest.modules).toHaveLength(1);
  expect(Object.values(project.workspaces).flatMap(w => w.blocks.blocks)).toEqual([]);
  expect(project.resources).toEqual({});
  expect(project.manifest.resources).toEqual([]);
  expect(project.manifest.appSurfaces).toEqual([]);
  expect(hook.result.current.question).toBe("");
});

it("starts the selected blueprint as a fresh project with a unique identity and cleared chat state", async () => {
  const hook = renderHook(() => useStudio());
  await waitFor(() => expect(hook.result.current.compiling).toBe(false));
  const initialId = hook.result.current.snapshot.project.manifest.projectId;
  await act(() => hook.result.current.startBlueprint("work-assistant"));
  await waitFor(() => expect(hook.result.current.started).toBe(true));
  expect(hook.result.current.snapshot.project.manifest.projectId).not.toBe(initialId);
  expect(hook.result.current.snapshot.project.manifest.displayName).toBe("工作助手");
  expect(hook.result.current.snapshot.project.manifest.modules).toHaveLength(1);
  expect(hook.result.current.question).toBe("");
  expect(hook.result.current.events).toEqual([]);
  expect(hook.result.current.result).toBeUndefined();
  expect(hook.result.current.runInput).toBeUndefined();
});

it("uses the same dirty-project confirmation before replacing a project with a starter", async () => {
  const hook = renderHook(() => useStudio());
  await waitFor(() => expect(hook.result.current.compiling).toBe(false));
  const originalId = hook.result.current.snapshot.project.manifest.projectId;
  act(() => hook.result.current.controller.edit((project) => {
    project.manifest.displayName = "未保存修改";
  }));

  let rejectedStart!: Promise<void>;
  act(() => {
    rejectedStart = hook.result.current.startBlueprint("coding-assistant");
  });
  await waitFor(() => expect(hook.result.current.confirmation).toContain("放弃"));
  act(() => hook.result.current.answerConfirmation(false));
  await act(async () => rejectedStart);
  expect(hook.result.current.snapshot.project.manifest.projectId).toBe(originalId);
  expect(hook.result.current.snapshot.project.manifest.displayName).toBe("未保存修改");

  let acceptedStart!: Promise<void>;
  act(() => {
    acceptedStart = hook.result.current.startBlueprint("coding-assistant");
  });
  await waitFor(() => expect(hook.result.current.confirmation).toContain("放弃"));
  act(() => hook.result.current.answerConfirmation(true));
  await act(async () => acceptedStart);
  expect(hook.result.current.snapshot.project.manifest.displayName).toBe("Coding 助手");
  expect(hook.result.current.snapshot.project.manifest.projectId).not.toBe(originalId);
});

it("applies only a real saved default model to newly created blueprints, never to blank or opened projects", async () => {
  const model: Resource = {
    schemaVersion: "blocky.resource/v1alpha1",
    resourceId: "model-local-default",
    kind: "model",
    scope: "user",
    displayName: "已配置的本机模型",
    definition: {
      provider: "managed-local",
      protocol: "local",
      modelId: "qwen3-0.6b-q8-v1",
      timeoutMs: 120000,
      capabilities: ["text", "tools", "structured-output"],
      implementationRef: { kind: "adapter", id: "managed-local-v1" },
    },
    secretBindings: [],
    capabilityRequirements: [],
  };
  const settings = updateSetting(
    createSettings("app"),
    "models.defaultResourceId",
    model.resourceId,
  );
  const resources = upsertUserResource(emptyRegistry(), model);
  localStorage.setItem("blocky.settings.app", JSON.stringify(settings));
  localStorage.setItem("blocky.resources.app", JSON.stringify(resources));

  const hook = renderHook(() => useStudio());
  await waitFor(() => expect(hook.result.current.settings.ready).toBe(true));
  await waitFor(() => expect(hook.result.current.resources.ready).toBe(true));
  await act(() => hook.result.current.fresh());
  expect(hook.result.current.snapshot.project.manifest.resources).toEqual([]);

  await act(() => hook.result.current.startBlueprint("work-assistant"));
  const created = hook.result.current.snapshot.project;
  const loop = [...walkBlocks(created.workspaces.main.blocks.blocks)].find(
    (block) => block.type === "core.reason.tool_loop",
  );
  expect(loop?.fields?.RESOURCE).toBe(model.resourceId);
  expect(created.manifest.resources).toContainEqual(
    expect.objectContaining({
      resourceId: model.resourceId,
      kind: "model",
      scope: "user",
      definitionRef: model.resourceId,
    }),
  );

  const opened = createStartingBlueprintForTest("pi-agent", "existing-pi");
  vi.mocked(openProject).mockResolvedValue({
    handle: "existing-handle",
    files: {},
    displayName: "Pi Agent",
    project: opened,
  });
  await act(() => hook.result.current.open());
  const existingLoop = [...walkBlocks(opened.workspaces.main.blocks.blocks)].find(
    (block) => block.type === "core.reason.tool_loop",
  );
  expect(existingLoop?.fields?.RESOURCE).toBe("assistant-model");
  expect(hook.result.current.snapshot.project.workspaces.main.blocks.blocks[0].id).toBe(
    opened.workspaces.main.blocks.blocks[0].id,
  );
});

it("starts empty before opening and gives each new project its own identity", async () => {
  const hook = renderHook(() => useStudio());
  await waitFor(() => expect(hook.result.current.compiling).toBe(false));
  expect(Object.values(hook.result.current.snapshot.project.workspaces).flatMap(w => w.blocks.blocks)).toEqual([]);
  const initial = hook.result.current.snapshot.project.manifest.projectId;
  await act(() => hook.result.current.fresh());
  const first = hook.result.current.snapshot.project.manifest.projectId;
  await act(() => hook.result.current.fresh());
  expect(new Set([initial, first, hook.result.current.snapshot.project.manifest.projectId]).size).toBe(3);
});

it("keeps personal blueprints while listing all four official starts in the library", async () => {
  const hook = renderHook(() => useStudio());
  await waitFor(() => expect(hook.result.current.compiling).toBe(false));
  await waitFor(() => expect(hook.result.current.resources.ready).toBe(true));
  const personal = {
    blueprintId: "personal-report",
    displayName: "我的专项蓝图",
  } as Parameters<typeof Library>[0]["blueprints"][number];
  const construction = {
    busy: false,
    legacy: [],
    importedLegacy: undefined,
    importBlueprint: vi.fn(),
    migrateLibrary: vi.fn(),
    migrateImported: vi.fn(),
  } as unknown as Parameters<typeof Library>[0]["construction"];
  render(
    <Library
      studio={hook.result.current}
      search={() => {}}
      add={() => {}}
      blueprints={[personal]}
      insert={() => {}}
      construction={construction}
      update={() => {}}
      onContext={() => {}}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "蓝图" }));
  expect(screen.getByRole("button", { name: "新建：知识问答助手" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "新建：工作助手" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "新建：Coding 助手" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "新建：Pi Agent" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "新建空白项目" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "我的专项蓝图 ＋" })).toBeTruthy();
});
