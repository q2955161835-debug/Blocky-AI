// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { RunModelChoice } from "../../apps/studio-desktop/src/app/RunModelChoice";
import { ProjectController } from "../../packages/project-model/src/index";
import { createAgentExample } from "../../packages/test-fixtures/src/scenarios";
import type { Studio } from "../../apps/studio-desktop/src/composition/useStudio";
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
