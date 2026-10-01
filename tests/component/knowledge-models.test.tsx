// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { KnowledgeQueryPanel } from "../../apps/studio-desktop/src/app/KnowledgeQueryPanel";
import { retrievalOptions } from "../../packages/knowledge-core/src/retrieval";
const e5 = "multilingual-e5-small-int8-v1",
  mini = "minilm-l6-v2-int8-v1",
  neural = "ms-marco-minilm-l6-v2-int8-v1";
afterEach(cleanup);
it("binds selected embedding and neural reranker after reopening settings", () => {
  let bound: unknown;
  render(
    <KnowledgeQueryPanel
      call={async () => null}
      projectId="p"
      collectionId="c"
      version="1"
      busy={false}
      canBind
      initialOptions={retrievalOptions({
        strategy: "hybrid",
        modelId: mini,
        rerankModelId: neural,
      })}
      run={async (work) => work(new AbortController().signal)}
      onBind={(value) => {
        bound = value;
      }}
    />,
  );
  expect((screen.getByLabelText("嵌入模型") as HTMLSelectElement).value).toBe(
    mini,
  );
  expect((screen.getByLabelText("重排方式") as HTMLSelectElement).value).toBe(
    neural,
  );
  expect(screen.getByText(/MiniLM 适用于英文资料/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText("嵌入模型"), {
    target: { value: e5 },
  });
  fireEvent.change(screen.getByLabelText("重排方式"), {
    target: { value: "rule" },
  });
  fireEvent.click(screen.getByRole("button", { name: "用于当前知识积木" }));
  expect(bound).toMatchObject({ modelId: e5, rerank: true });
  expect((bound as Record<string, unknown>).rerankModelId).toBeUndefined();
});
it("prepares selected model, builds its index and activates only compatible rollback snapshots", async () => {
  const operations: { op: string; fields: Record<string, unknown> }[] = [];
  let active = mini;
  const call = async (op: string, fields: Record<string, unknown>) => {
    operations.push({ op, fields });
    if (op === "knowledge-model-install")
      return { modelId: fields.modelId, verified: true, dimension: 384 };
    if (op === "knowledge-sources")
      return { revision: 7, generation: 3, sources: [] };
    if (op === "knowledge-embed-index") return { embedded: 2, reused: 1 };
    if (op === "knowledge-embedding-status")
      return {
        indexRevision: 7,
        generation: 3,
        models: [
          {
            modelId: e5,
            dimension: 384,
            chunkCount: 3,
            compatible: true,
            active: active === e5,
          },
          {
            modelId: mini,
            dimension: 384,
            chunkCount: 3,
            compatible: true,
            active: active === mini,
          },
        ],
      };
    if (op === "knowledge-embedding-activate") {
      active = String(fields.modelId);
      return { activated: true };
    }
    throw Error(op);
  };
  render(
    <KnowledgeQueryPanel
      call={call}
      projectId="p"
      collectionId="c"
      version="1"
      busy={false}
      canBind
      initialOptions={retrievalOptions({ strategy: "vector", modelId: mini })}
      run={async (work) => work(new AbortController().signal)}
      onBind={() => {}}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "准备本地模型" }));
  await screen.findByText(/本地模型已就绪/);
  expect(operations[0]).toEqual({
    op: "knowledge-model-install",
    fields: { projectId: "p", collectionId: "c", modelId: mini },
  });
  fireEvent.click(screen.getByRole("button", { name: "建立 / 更新向量索引" }));
  await screen.findByText(/向量索引已更新/);
  expect(
    operations.find((v) => v.op === "knowledge-embed-index")?.fields,
  ).toMatchObject({
    modelId: mini,
    expectedRevision: 7,
    expectedGeneration: 3,
  });
  fireEvent.click(screen.getByRole("button", { name: "检查索引状态" }));
  await screen.findByRole("button", { name: "切换到 E5 索引" });
  fireEvent.click(screen.getByRole("button", { name: "切换到 E5 索引" }));
  await waitFor(() =>
    expect((screen.getByLabelText("嵌入模型") as HTMLSelectElement).value).toBe(
      e5,
    ),
  );
  expect(
    operations.find((v) => v.op === "knowledge-embedding-activate")?.fields,
  ).toEqual({
    projectId: "p",
    collectionId: "c",
    modelId: e5,
    expectedRevision: 7,
    expectedGeneration: 3,
  });
});
it("prevents switching stale indices and discards model preparation completed after stop", async () => {
  const controller = new AbortController();
  let resolve!: (value: unknown) => void;
  render(
    <KnowledgeQueryPanel
      call={async (op) => {
        if (op === "knowledge-model-install")
          return new Promise((r) => {
            resolve = r;
          });
        if (op === "knowledge-embedding-status")
          return {
            indexRevision: 7,
            generation: 3,
            models: [
              {
                modelId: e5,
                compatible: false,
                active: false,
                dimension: 384,
                chunkCount: 3,
              },
            ],
          };
        throw Error(op);
      }}
      projectId="p"
      collectionId="c"
      version="1"
      busy={false}
      canBind
      initialOptions={retrievalOptions({ strategy: "vector" })}
      run={async (work) => {
        try {
          await work(controller.signal);
        } catch {}
      }}
      onBind={() => {}}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "检查索引状态" }));
  const button = await screen.findByRole("button", { name: "切换到 E5 索引" });
  expect((button as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "准备本地模型" }));
  controller.abort();
  resolve({ verified: true, dimension: 384 });
  await waitFor(() => expect(screen.queryByText(/本地模型已就绪/)).toBeNull());
});
