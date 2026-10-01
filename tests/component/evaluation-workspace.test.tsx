// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { createStarter } from "../../packages/test-fixtures/src";
import type { Studio } from "../../apps/studio-desktop/src/composition/useStudio";
import { EvaluationWorkspace } from "../../apps/studio-desktop/src/app/EvaluationWorkspace";

vi.mock("../../apps/studio-desktop/src/composition/agent", () => ({
  studioAgentServices: () => ({ evaluation: {}, close: async () => {} }),
}));
vi.mock("../../apps/studio-desktop/src/app/EvaluationPanel", () => ({
  EvaluationPanel: ({ model }: { model: unknown }) => (
    <output aria-label="评估模型绑定">{JSON.stringify(model)}</output>
  ),
}));
afterEach(cleanup);

it("identifies the legacy local composer instead of freezing undefined model fields", async () => {
  const studio = {
    snapshot: { project: createStarter() },
    resources: { map: new Map() },
    rpaInput: { request: {} },
  } as unknown as Studio;
  render(<EvaluationWorkspace studio={studio} />);
  const identity = await screen.findByText(/模型配置：/);
  expect(identity.textContent).toContain("本地文本整理");
  expect(identity.textContent).not.toContain("undefined");
  expect(JSON.parse(screen.getByLabelText("评估模型绑定").textContent!)).toMatchObject({
    provider: "deterministic",
    modelId: "adapter://deterministic/composer-v1",
  });
});
