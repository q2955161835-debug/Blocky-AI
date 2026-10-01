// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createEvaluationDataset,
  freezeEvaluationDataset,
  type EvaluationAssetKind,
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

  async list(kind: EvaluationAssetKind) {
    return [...this.values.values()]
      .filter((item) => item.kind === kind)
      .map(({ kind: itemKind, key, revision }) => ({
        kind: itemKind,
        key,
        revision,
      }));
  }
}

describe("evaluation panel", () => {
  afterEach(cleanup);
  it("creates an editable dataset draft bound to the active model", async () => {
    render(
      <EvaluationPanel
        project={createStarter()}
        model={binding.model}
        bindingHash={binding.configurationHash}
        store={new MemoryStore()}
        execute={async () => ({ status: "completed" })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "新建评估集" }));

    const editor = await screen.findByLabelText("评估集 JSON");
    const created = JSON.parse((editor as HTMLTextAreaElement).value);
    expect(created.status).toBe("draft");
    expect(created.binding).toEqual(binding);
    expect(created.name).toBe("新建评估集");
    expect(created.cases).toHaveLength(1);
    expect(created.cases[0]).not.toHaveProperty("expected");
    fireEvent.click(screen.getByRole("button", { name: "导入评估集" }));
    await screen.findByText(/已导入草稿 v1/);
  });

  it("reopens a saved report into the comparison editor without result bodies", async () => {
    const store = new MemoryStore();
    const dataset = createEvaluationDataset({
      datasetId: "saved-report-cases",
      name: "Saved report cases",
      binding,
      createdAt: 1,
      cases: [{ caseId: "saved-report-case", input: "question" }],
    });
    render(
      <EvaluationPanel
        project={createStarter()}
        model={binding.model}
        bindingHash={binding.configurationHash}
        store={store}
        execute={async () => ({
          status: "completed",
          answer: "private answer body",
        })}
      />,
    );
    fireEvent.change(screen.getByLabelText("评估集 JSON"), {
      target: { value: JSON.stringify(dataset) },
    });
    fireEvent.click(screen.getByRole("button", { name: "导入评估集" }));
    await screen.findByText(/已导入草稿 v1/);
    fireEvent.click(screen.getByRole("button", { name: "冻结并保存版本" }));
    await screen.findByText(/已冻结并保存 v1/);
    fireEvent.click(screen.getByRole("button", { name: "创建批次" }));
    await screen.findByText(/批次完成 · 1 行/);

    fireEvent.click(screen.getByRole("button", { name: "刷新已保存资产" }));
    await screen.findByText("已刷新已保存评估资产");
    const datasetSelect = screen.getByLabelText(
      "已保存评估集",
    ) as HTMLSelectElement;
    await waitFor(() => expect(datasetSelect.options.length).toBe(2));
    fireEvent.click(screen.getByRole("button", { name: "加载评估集" }));
    await screen.findByText("已加载并校验评估集 v1");
    const reportSelect = screen.getByLabelText(
      "已保存报告",
    ) as HTMLSelectElement;
    await waitFor(() => expect(reportSelect.options.length).toBe(2));
    fireEvent.change(reportSelect, {
      target: { value: reportSelect.options[1]?.value },
    });
    fireEvent.click(screen.getByRole("button", { name: "加载报告" }));
    await waitFor(() =>
      expect(
        (screen.getByLabelText("对照报告 JSON") as HTMLTextAreaElement).value,
      ).toContain('"schemaVersion": "blocky.evaluation-report/v1"'),
    );
    fireEvent.click(screen.getByRole("button", { name: "比较报告" }));
    expect(await screen.findByLabelText("报告差异")).toBeTruthy();
    expect(screen.queryByText("private answer body")).toBeNull();
  });

  it("rejects oversized evaluation files before reading their contents", () => {
    render(
      <EvaluationPanel
        project={createStarter()}
        model={binding.model}
        bindingHash={binding.configurationHash}
        store={new MemoryStore()}
        execute={async () => ({ status: "completed" })}
      />,
    );
    const text = vi.fn(async () => "{}");
    const oversized = {
      size: 8 * 1024 * 1024 + 1,
      text,
    } as unknown as File;
    fireEvent.change(screen.getByLabelText("导入评估集文件"), {
      target: { files: [oversized] },
    });

    expect(text).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toBe(
      "BLK-EVAL-FILE-TOO-LARGE",
    );
  });

  it("keeps stored-asset controls hidden for stores without optional listing", () => {
    const store: EvaluationAssetStore = {
      read: async () => null,
      compareAndSwap: async () => {
        throw Error("unavailable");
      },
    };
    render(
      <EvaluationPanel
        project={createStarter()}
        model={binding.model}
        bindingHash={binding.configurationHash}
        store={store}
        execute={async () => ({ status: "completed" })}
      />,
    );

    expect(screen.queryByRole("button", { name: "刷新已保存资产" })).toBeNull();
  });

  it("rejects a saved checkpoint bound to a different candidate", async () => {
    const store = new MemoryStore();
    const dataset = await freezeEvaluationDataset(
      createEvaluationDataset({
        datasetId: "checkpoint-cases",
        name: "Checkpoint cases",
        binding,
        createdAt: 1,
        cases: [{ caseId: "checkpoint-case", input: "question" }],
      }),
    );
    const hash = "b".repeat(64);
    const checkpoint = {
      schemaVersion: "blocky.evaluation-checkpoint/v1" as const,
      checkpointId: "different-candidate-checkpoint",
      reportId: "different-candidate-report",
      datasetId: dataset.datasetId,
      datasetVersion: dataset.version,
      datasetContentHash: dataset.contentHash!,
      binding,
      candidate: {
        id: createStarter().manifest.projectId,
        version: hash,
        contentHash: hash,
      },
      resultDetailPolicy: "summary" as const,
      status: "cancelled" as const,
      createdAt: 1,
      updatedAt: 1,
      cases: [{ caseId: "checkpoint-case", status: "pending" as const }],
      modelScoring: { status: "not-run" as const, rows: [] },
    };
    await store.compareAndSwap(
      "checkpoint",
      checkpoint.checkpointId,
      null,
      checkpoint,
    );
    render(
      <EvaluationPanel
        project={createStarter()}
        model={binding.model}
        bindingHash={binding.configurationHash}
        store={store}
        execute={async () => ({ status: "completed" })}
      />,
    );
    fireEvent.change(screen.getByLabelText("评估集 JSON"), {
      target: { value: JSON.stringify(dataset) },
    });
    fireEvent.click(screen.getByRole("button", { name: "导入评估集" }));
    await screen.findByText(/已导入冻结版本 v1/);
    fireEvent.click(screen.getByRole("button", { name: "刷新已保存资产" }));
    await screen.findByRole("option", {
      name: /different-candidate-checkpoint/,
    });
    fireEvent.change(screen.getByLabelText("已保存检查点"), {
      target: { value: checkpoint.checkpointId },
    });
    fireEvent.click(screen.getByRole("button", { name: "加载检查点" }));

    await screen.findByRole("alert");
    expect(screen.getByRole("alert").textContent).toBe(
      "BLK-EVAL-CHECKPOINT-BINDING",
    );
    expect(
      (
        screen.getByRole("button", {
          name: "继续未完成批次",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

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
