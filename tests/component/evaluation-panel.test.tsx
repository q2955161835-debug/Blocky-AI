// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  createEvaluationDataset,
  type EvaluationAssetStore,
  type EvaluationStoredAsset,
} from "../../packages/runtime-core/src/evaluation";
import { createStarter } from "../../packages/test-fixtures/src";
import { EvaluationPanel } from "../../apps/studio-desktop/src/app/EvaluationPanel";

const binding = {
  configurationHash: "a".repeat(64),
  model: {
    resourceId: "model-local",
    provider: "local",
    modelId: "answer-model",
    version: "1.0",
  },
};

class MemoryStore implements EvaluationAssetStore {
  private values = new Map<string, EvaluationStoredAsset>();

  async read(kind: EvaluationStoredAsset["kind"], key: string) {
    return this.values.get(`${kind}:${key}`) ?? null;
  }

  async compareAndSwap(
    kind: EvaluationStoredAsset["kind"],
    key: string,
    expectedRevision: number | null,
    value: EvaluationStoredAsset["value"],
  ) {
    const id = `${kind}:${key}`;
    const current = this.values.get(id);
    if ((current?.revision ?? null) !== expectedRevision)
      throw Error("BLK-EVAL-CAS");
    const next = {
      kind,
      key,
      revision: (current?.revision ?? 0) + 1,
      value,
    } as EvaluationStoredAsset;
    this.values.set(id, next);
    return next;
  }
}

describe("evaluation panel", () => {
  it("imports and freezes a bound dataset, runs through the injected runtime, and shows row summaries", async () => {
    const store = new MemoryStore();
    const dataset = createEvaluationDataset({
      datasetId: "support-cases",
      name: "Support cases",
      binding,
      createdAt: 1,
      cases: [
        {
          caseId: "case-one",
          input: "private user question",
          expected: { answer: "private expected answer" },
        },
      ],
    });
    const execute = async () => ({
      status: "completed" as const,
      answer: "private expected answer",
    });
    const view = render(
      <EvaluationPanel
        project={createStarter()}
        model={binding.model}
        bindingHash={binding.configurationHash}
        store={store}
        execute={execute}
      />,
    );
    fireEvent.change(screen.getByLabelText("评估集 JSON"), {
      target: { value: JSON.stringify(dataset) },
    });
    fireEvent.click(screen.getByRole("button", { name: "导入评估集" }));
    await screen.findByText(/已导入草稿 v1/);
    await waitFor(() =>
      expect(
        (
          screen.getByRole("button", {
            name: "冻结并保存版本",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false),
    );
    fireEvent.click(screen.getByRole("button", { name: "冻结并保存版本" }));
    await screen.findByText(/已冻结并保存 v1/);
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "创建批次" }) as HTMLButtonElement)
          .disabled,
      ).toBe(false),
    );
    fireEvent.click(screen.getByRole("button", { name: "创建批次" }));
    await screen.findByText(/批次完成 · 1 行/);
    expect(await store.read("dataset", "support-cases:v1")).not.toBeNull();
    expect(screen.getByText("case-one")).toBeTruthy();
    expect(screen.getByText("通过")).toBeTruthy();
    expect(screen.queryByText("private expected answer")).toBeNull();
    view.unmount();
    cleanup();
  });

  it("cancels work and ignores late results after switching projects", async () => {
    const store = new MemoryStore();
    const dataset = createEvaluationDataset({
      datasetId: "switch-cases",
      name: "Switch cases",
      binding,
      createdAt: 1,
      cases: [{ caseId: "switch-one", input: "question" }],
    });
    let start!: () => void;
    const started = new Promise<void>((resolve) => {
      start = resolve;
    });
    let finish!: (value: { status: "completed"; answer: string }) => void;
    let runSignal: AbortSignal | undefined;
    const execute = (
      _testCase: (typeof dataset.cases)[number],
      context: { signal: AbortSignal },
    ) => {
      runSignal = context.signal;
      start();
      return new Promise<{ status: "completed"; answer: string }>((resolve) => {
        finish = resolve;
      });
    };
    const firstProject = createStarter();
    const view = render(
      <EvaluationPanel
        project={firstProject}
        model={binding.model}
        bindingHash={binding.configurationHash}
        store={store}
        execute={execute}
      />,
    );
    fireEvent.change(screen.getByLabelText("评估集 JSON"), {
      target: { value: JSON.stringify(dataset) },
    });
    fireEvent.click(screen.getByRole("button", { name: "导入评估集" }));
    await screen.findByText(/已导入草稿 v1/);
    await waitFor(() =>
      expect(
        (
          screen.getByRole("button", {
            name: "冻结并保存版本",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false),
    );
    fireEvent.click(screen.getByRole("button", { name: "冻结并保存版本" }));
    await screen.findByText(/已冻结并保存 v1/);
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "创建批次" }) as HTMLButtonElement)
          .disabled,
      ).toBe(false),
    );
    fireEvent.click(screen.getByRole("button", { name: "创建批次" }));
    await started;

    const secondProject = createStarter();
    secondProject.manifest.projectId = "second-project";
    view.rerender(
      <EvaluationPanel
        project={secondProject}
        model={binding.model}
        bindingHash={binding.configurationHash}
        store={store}
        execute={execute}
      />,
    );
    await waitFor(() => expect(runSignal?.aborted).toBe(true));
    await act(async () => {
      finish({ status: "completed", answer: "late answer" });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByText("late answer")).toBeNull();
    view.unmount();
    cleanup();
  });
});
