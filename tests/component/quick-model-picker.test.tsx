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
import {
  useStudio,
  type Studio,
} from "../../apps/studio-desktop/src/composition/useStudio";
import {
  useCodingAgent,
  type CodingAgent,
} from "../../apps/studio-desktop/src/composition/useCodingAgent";
import { StudioSidebar } from "../../apps/studio-desktop/src/app/StudioSidebar";
import { createAgentExample } from "../../packages/test-fixtures/src/scenarios";
import { modelResource } from "../fixtures/model-resource";
import {walkBlocks} from "../../packages/block-catalog/src";
vi.mock("../../apps/studio-desktop/src/composition/host", async () => {
  const original = await vi.importActual<
    typeof import("../../apps/studio-desktop/src/composition/host")
  >("../../apps/studio-desktop/src/composition/host");
  return {
    ...original,
    saveProject: vi.fn(async () => ({
      handle: "saved-test",
      displayName: "picker-test.blocky",
    })),
  };
});
let studio: Studio, builder: CodingAgent;
function Harness() {
  studio = useStudio(createAgentExample("picker-project"));
  builder = useCodingAgent(studio);
  return (
    <StudioSidebar
      studio={studio}
      builder={builder}
      enabled={() => true}
      execute={() => {}}
      onTraceContext={() => {}}
    />
  );
}
afterEach(async () => {
  cleanup();
  await studio.settings.flush().catch(() => {});
  await builder.flush();
  localStorage.clear();
});
it("keeps both drafts while quick model choices persist independently", async () => {
  const models = ["first-model", "second-model"].map((id) => ({
    ...modelResource(id),
    displayName: id,
    definition: {
      ...modelResource(id).definition,
      capabilities: ["text", "tools"],
    },
  }));
  localStorage.setItem(
    "blocky.resources.app",
    JSON.stringify({
      schemaVersion: "blocky.resource-registry/v2",
      revision: 1,
      providers: [],
      resources: models,
    }),
  );
  localStorage.setItem(
    "blocky.settings.app",
    JSON.stringify({
      schemaVersion: "blocky.settings/v1",
      scope: "app",
      values: { "models.defaultResourceId": "first-model" },
    }),
  );
  render(<Harness />);
  await waitFor(() =>
    expect(
      studio.settings.ui.ready && builder.ready && studio.resources.ready,
    ).toBe(true),
  );
  fireEvent.click(screen.getByRole("tab", { name: "构建助手" }));
  fireEvent.change(screen.getByLabelText("构建需求"), {
    target: { value: "保留构建输入" },
  });
  fireEvent.click(screen.getByRole("button", { name: "构建助手模型与思考" }));
  fireEvent.change(screen.getByRole("combobox", { name: "构建助手模型" }), {
    target: { value: "second-model" },
  });
  await act(() => studio.settings.flush());
  expect((screen.getByLabelText("构建需求") as HTMLTextAreaElement).value).toBe(
    "保留构建输入",
  );
  expect(studio.settings.ui.values.builderModelId).toBe("second-model");
  expect(studio.settings.app.values["models.defaultResourceId"]).toBe(
    "first-model",
  );
  fireEvent.click(screen.getByRole("tab", { name: "Blocky Agent" }));
  fireEvent.change(screen.getByLabelText("向 Agent 提问"), {
    target: { value: "保留问题输入" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Blocky Agent 模型与思考" }));
  fireEvent.change(
    screen.getByRole("combobox", { name: "快捷运行模型 compose-answer" }),
    { target: { value: "first-model" } },
  );
  await waitFor(() => expect(studio.busy).toBe(false));
  expect(
    (screen.getByLabelText("向 Agent 提问") as HTMLTextAreaElement).value,
  ).toBe("保留问题输入");
  const chosen=Object.values(studio.snapshot.project.workspaces).flatMap(workspace=>[...walkBlocks(workspace.blocks.blocks)]).find(block=>block.id==="compose-answer");
  expect(chosen?.fields?.RESOURCE).toBe("first-model");
  expect(
    studio.snapshot.project.manifest.resources.some(
      (r) => r.resourceId === "first-model" && r.scope === "user",
    ),
  ).toBe(true);
  expect(studio.settings.ui.values.builderModelId).toBe("second-model");
});
