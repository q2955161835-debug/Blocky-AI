import { useEffect, useRef, useState } from "react";
import {
  KnowledgeSearch,
  LOCAL_EMBEDDING_MODEL,
  type KnowledgeCall,
  type RetrievalOptions,
} from "@blocky/knowledge-core";
const models = [
  { id: LOCAL_EMBEDDING_MODEL, name: "E5", label: "E5 · 多语言" },
  { id: "minilm-l6-v2-int8-v1", name: "MiniLM", label: "MiniLM · 英文" },
];
const reranker = "ms-marco-minilm-l6-v2-int8-v1";
type IndexStatus = {
  indexRevision: number;
  generation: number;
  models: {
    modelId: string;
    dimension: number;
    chunkCount: number;
    active: boolean;
    compatible: boolean;
  }[];
};
export function KnowledgeModelsPanel({
  call,
  search,
  options,
  setOptions,
  busy,
  version,
  run,
}: {
  call: KnowledgeCall;
  search: KnowledgeSearch;
  options: RetrievalOptions;
  setOptions: (
    update: (previous: RetrievalOptions) => RetrievalOptions,
  ) => void;
  busy: boolean;
  version: string;
  run: (work: (signal: AbortSignal) => Promise<void>) => Promise<void>;
}) {
  const [message, setMessage] = useState("尚未检查本地模型"),
    [indices, setIndices] = useState<IndexStatus>();
  const epoch = useRef(0);
  useEffect(() => {
    epoch.current++;
    setIndices(undefined);
    setMessage("尚未检查本地模型");
    return () => {
      epoch.current++;
    };
  }, [search, version]);
  const invoke = (op: string, fields: Record<string, unknown> = {}) =>
    call(op, {
      projectId: search.projectId,
      collectionId: search.collectionId,
      ...fields,
    });
  const work = (
    operation: (
      signal: AbortSignal,
      publish: (message: string) => void,
      current: () => boolean,
    ) => Promise<void>,
  ) => {
    const started = epoch.current;
    void run(async (signal) => {
      const current = () => epoch.current === started && !signal.aborted;
      const publish = (text: string) => {
        if (current()) setMessage(text);
      };
      signal.throwIfAborted();
      try {
        await operation(signal, publish, current);
      } catch (error) {
        publish("模型操作未完成，请检查工件和索引状态后重试。");
        throw error;
      }
    });
  };
  const prepare = (modelId: string) =>
    work(async (signal, publish) => {
      publish("正在校验并加载本地模型…");
      const value = (await invoke("knowledge-model-install", { modelId })) as {
        verified: boolean;
        dimension?: number;
      };
      signal.throwIfAborted();
      publish(
        value.verified
          ? `本地模型已就绪${value.dimension ? ` · ${value.dimension} 维` : ""}`
          : "本地模型未通过校验，请修复安装工件。",
      );
    });
  return (
    <section aria-label="知识模型与索引">
      <label>
        嵌入模型
        <select
          aria-label="嵌入模型"
          value={options.modelId}
          disabled={busy}
          onChange={(event) => {
            const modelId = event.target.value;
            setOptions((previous) => ({ ...previous, modelId }));
          }}
        >
          {models.map((model) => (
            <option key={model.id} value={model.id}>
              {model.label}
            </option>
          ))}
        </select>
      </label>
      {options.modelId === "minilm-l6-v2-int8-v1" && (
        <p>MiniLM 适用于英文资料；中文资料建议使用多语言 E5。</p>
      )}
      <label>
        重排方式
        <select
          aria-label="重排方式"
          disabled={busy}
          value={!options.rerank ? "none" : (options.rerankModelId ?? "rule")}
          onChange={(event) => {
            const selected = event.target.value;
            setOptions((previous) => {
              const { rerankModelId: _old, ...rest } = previous;
              return {
                ...rest,
                rerank: selected !== "none",
                ...(selected === reranker ? { rerankModelId: reranker } : {}),
              };
            });
          }}
        >
          <option value="none">不重排</option>
          <option value="rule">规则重排 · 正文和标题</option>
          <option value={reranker}>神经重排 · 本地 MiniLM</option>
        </select>
      </label>
      <p role="status">{message}</p>
      {options.strategy !== "keyword" && (
        <>
          <button disabled={busy} onClick={() => prepare(options.modelId)}>
            准备本地模型
          </button>
          <button
            disabled={busy}
            onClick={() =>
              work(async (signal, publish, current) => {
                publish("正在计算向量；可停止，随后继续未完成的部分。");
                const value = (await search.embed(options.modelId)) as {
                  embedded: number;
                  reused: number;
                };
                signal.throwIfAborted();
                if (current()) setIndices(undefined);
                publish(
                  `向量索引已更新 · 新计算 ${value.embedded} · 复用 ${value.reused}`,
                );
              })
            }
          >
            建立 / 更新向量索引
          </button>
        </>
      )}
      {options.rerank && options.rerankModelId && (
        <button disabled={busy} onClick={() => prepare(reranker)}>
          准备神经重排模型
        </button>
      )}
      <button
        disabled={busy}
        onClick={() =>
          work(async (signal, publish, current) => {
            const status = (await invoke(
              "knowledge-embedding-status",
            )) as IndexStatus;
            signal.throwIfAborted();
            if (current()) setIndices(status);
            publish(
              status.models.length
                ? "索引状态已更新；只可切换与当前资料版本兼容的索引。"
                : "尚无向量索引，请先同步资料并建立向量索引。",
            );
          })
        }
      >
        检查索引状态
      </button>
      {indices && (
        <ul aria-label="已保存的向量索引">
          {indices.models.map((index) => {
            const model = models.find((value) => value.id === index.modelId);
            if (!model) return null;
            return (
              <li key={index.modelId}>
                {model.name} · {index.dimension} 维 · {index.chunkCount} 个片段
                ·{" "}
                {index.active
                  ? "当前启用"
                  : index.compatible
                    ? "可切换"
                    : "资料已变化，请重建"}
                <button
                  disabled={busy || index.active || !index.compatible}
                  onClick={() =>
                    work(async (signal, publish, current) => {
                      await invoke("knowledge-embedding-activate", {
                        modelId: index.modelId,
                        expectedRevision: indices.indexRevision,
                        expectedGeneration: indices.generation,
                      });
                      signal.throwIfAborted();
                      if (!current()) return;
                      setOptions((previous) => ({
                        ...previous,
                        modelId: index.modelId,
                      }));
                      setIndices(undefined);
                      publish(`已切换到 ${model.name} 索引`);
                    })
                  }
                >
                  切换到 {model.name} 索引
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
