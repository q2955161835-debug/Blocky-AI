// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { RunModelChoice } from "../../apps/studio-desktop/src/app/RunModelChoice";
import {
  ProjectController,
  createEmptyProject,
} from "../../packages/project-model/src/index";
import { createAgentExample } from "../../packages/test-fixtures/src/scenarios";
import type { Studio } from "../../apps/studio-desktop/src/composition/useStudio";
import {
  createStartingBlueprint,
  walkBlocks,
} from "../../packages/block-catalog/src";
import { modelResource } from "../fixtures/model-resource";
it("keeps a model and effort picker on blank works without adding model blocks", () => {
  const controller = new ProjectController(createEmptyProject());
  const resource = modelResource("blank-model");
  const change = vi.fn();
  const save = vi.fn();
  const s = {
    snapshot: controller.getSnapshot(),
    controller,
    resources: { map: new Map([[resource.resourceId, resource]]) },
    save,
    settings: {
      ui: {
        ready: true,
        values: { agentModelId: "", agentReasoningEffort: "none" },
        change,
      },
    },
  } as unknown as Studio;
  render(<RunModelChoice studio={s} compact />);
  fireEvent.click(screen.getByRole("button", { name: "Blocky Agent 模型与思考" }));
  fireEvent.change(screen.getByRole("combobox", { name: "快捷运行模型" }), {
    target: { value: "blank-model" },
  });
  expect(change).toHaveBeenCalledWith("agentModelId", "blank-model");
  expect(save).not.toHaveBeenCalled();
  expect(
    Object.values(controller.getSnapshot().project.workspaces).flatMap(
      (workspace) => [...walkBlocks(workspace.blocks.blocks)],
    ),
  ).toHaveLength(0);
  expect(
    (
      screen.getByRole("combobox", {
        name: "Blocky Agent 思考等级",
      }) as HTMLSelectElement
    ).disabled,
  ).toBe(true);
  cleanup();
});
it("targets knowledge correction's MODEL field without overwriting another model block", () => {
  const p = createAgentExample("multi-model");
  const workspace = Object.values(p.workspaces)[0];
  workspace.blocks.blocks.push({
    id: "correct-answer",
    type: "core.knowledge.correct",
    fields: { MODEL: "agent-model" },
  });
  const controller = new ProjectController(p);
  const resource = modelResource("correction-model");
  const s = {
    snapshot: controller.getSnapshot(),
    controller,
    resources: { map: new Map([[resource.resourceId, resource]]) },
    save: vi.fn(async () => true),
  } as unknown as Studio;
  render(<RunModelChoice studio={s} compact />);
  fireEvent.click(screen.getByRole("button", { name: "Blocky Agent 模型与思考" }));
  const target = screen.getByRole("combobox", { name: "运行模型目标" });
  const correction = [...(target as HTMLSelectElement).options].find((option) =>
    option.value.endsWith("/correct-answer"),
  )!;
  fireEvent.change(target, { target: { value: correction.value } });
  fireEvent.change(
    screen.getByRole("combobox", { name: "快捷运行模型 correct-answer" }),
    { target: { value: "correction-model" } },
  );
  const blocks = Object.values(
    controller.getSnapshot().project.workspaces,
  ).flatMap((w) => [...walkBlocks(w.blocks.blocks)]);
  expect(
    blocks.find((block) => block.id === "correct-answer")?.fields?.MODEL,
  ).toBe("correction-model");
  expect(
    blocks.find((block) => block.id === "compose-answer")?.fields?.RESOURCE,
  ).toBe("agent-model");
  cleanup();
});
it.each(["work-assistant", "coding-assistant", "pi-agent"] as const)(
  "restores the tool-loop quick model choice for %s and saves an undoable change",
  (id) => {
    const controller = new ProjectController(
      createStartingBlueprint(id, `picker-${id}`),
    );
    const resource = modelResource("quick-model");
    const save = vi.fn(async () => true);
    const studio = {
      snapshot: controller.getSnapshot(),
      controller,
      resources: { map: new Map([[resource.resourceId, resource]]) },
      save,
    } as unknown as Studio;
    render(<RunModelChoice studio={studio} compact />);
    fireEvent.click(screen.getByRole("button", { name: "Blocky Agent 模型与思考" }));
    fireEvent.change(
      screen.getByRole("combobox", {
        name: "快捷运行模型 assistant-tool-loop",
      }),
      { target: { value: "quick-model" } },
    );
    const chosen = [
      ...walkBlocks(
        controller.getSnapshot().project.workspaces.main.blocks.blocks,
      ),
    ].find((block) => block.id === "assistant-tool-loop");
    expect(chosen?.fields?.RESOURCE).toBe("quick-model");
    expect(save).toHaveBeenCalledOnce();
    controller.undo();
    expect(
      [
        ...walkBlocks(
          controller.getSnapshot().project.workspaces.main.blocks.blocks,
        ),
      ].find((block) => block.id === "assistant-tool-loop")?.fields?.RESOURCE,
    ).toBe("assistant-model");
    cleanup();
  },
);
it("model choice persists a user resource reference and can undo the project edit", () => {
  const controller = new ProjectController(createAgentExample("stage4-ui"));
  const resource = {
    ...controller.getSnapshot().project.resources["agent-model"],
    resourceId: "online-model",
    scope: "user" as const,
    displayName: "Online",
    definition: {
      provider: "deepseek",
      protocol: "openai-chat",
      modelId: "configured-model",
      timeoutMs: 60000,
      capabilities: ["text"],
      implementationRef: { kind: "adapter", id: "deepseek-v1" },
    },
  };
  const save = vi.fn(async () => true);
  const studio = {
    snapshot: controller.getSnapshot(),
    controller,
    resources: { map: new Map([[resource.resourceId, resource]]) },
    running: false,
    busy: false,
    save,
  } as unknown as Studio;
  render(<RunModelChoice studio={studio} />);
  fireEvent.change(screen.getByLabelText("运行模型 compose-answer"), {
    target: { value: "online-model" },
  });
  expect(
    controller
      .getSnapshot()
      .project.manifest.resources.some(
        (r) => r.resourceId === "online-model" && r.scope === "user",
      ),
  ).toBe(true);
  expect(save).toHaveBeenCalledOnce();
  controller.undo();
  expect(
    controller
      .getSnapshot()
      .project.manifest.resources.some((r) => r.resourceId === "online-model"),
  ).toBe(false);
  cleanup();
});
