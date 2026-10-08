// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { RunModelChoice } from "../../apps/studio-desktop/src/app/RunModelChoice";
import { ProjectController } from "../../packages/project-model/src/index";
import { createAgentExample } from "../../packages/test-fixtures/src/scenarios";
import type { Studio } from "../../apps/studio-desktop/src/composition/useStudio";
import { createStartingBlueprint, walkBlocks } from "../../packages/block-catalog/src";
import { modelResource } from "../fixtures/model-resource";
it.each(["work-assistant", "coding-assistant", "pi-agent"] as const)("restores the tool-loop quick model choice for %s and saves an undoable change", id => {
  const controller = new ProjectController(createStartingBlueprint(id, `picker-${id}`));
  const resource = modelResource("quick-model");
  const save = vi.fn(async () => true);
  const studio = { snapshot: controller.getSnapshot(), controller, resources: { map: new Map([[resource.resourceId, resource]]) }, save } as unknown as Studio;
  render(<RunModelChoice studio={studio} compact />);
  fireEvent.change(screen.getByRole("combobox", { name: "快捷运行模型 assistant-tool-loop" }), { target: { value: "quick-model" } });
  const chosen = [...walkBlocks(controller.getSnapshot().project.workspaces.main.blocks.blocks)].find(block => block.id === "assistant-tool-loop");
  expect(chosen?.fields?.RESOURCE).toBe("quick-model");
  expect(save).toHaveBeenCalledOnce();
  controller.undo();
  expect([...walkBlocks(controller.getSnapshot().project.workspaces.main.blocks.blocks)].find(block => block.id === "assistant-tool-loop")?.fields?.RESOURCE).toBe("assistant-model");
  cleanup();
});
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
