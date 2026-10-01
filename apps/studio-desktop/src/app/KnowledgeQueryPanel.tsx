import { useEffect, useMemo, useState } from "react";
import {
  KnowledgeSearch,
  retrievalOptions,
  type KnowledgeCall,
  type RetrievalOptions,
  type SearchResult,
} from "@blocky/knowledge-core";
import { KnowledgeCitations } from "./KnowledgeCitations";
import { KnowledgeModelsPanel } from "./KnowledgeModelsPanel";
export function KnowledgeQueryPanel({
  call,
  projectId,
  collectionId,
  busy,
  version,
  run,
  onBind,
  canBind,
  initialOptions,
}: {
  call: KnowledgeCall;
  projectId: string;
  collectionId: string;
  busy: boolean;
  version: string;
  run: (work: (signal: AbortSignal) => Promise<void>) => Promise<void>;
  onBind: (options: RetrievalOptions) => void;
  canBind: boolean;
  initialOptions?: RetrievalOptions;
}) {
  const search = useMemo(
    () => new KnowledgeSearch(call, projectId, collectionId),
    [call, projectId, collectionId],
  );
  const [query, setQuery] = useState(""),
    [options, setOptions] = useState(initialOptions ?? retrievalOptions()),
    [result, setResult] = useState<SearchResult>(),
    [filterKey, setFilterKey] = useState(""),
    [filterValue, setFilterValue] = useState("");
  useEffect(() => {
    setResult(undefined);
  }, [version]);
  const settings = () =>
    retrievalOptions({
      ...options,
      filters: {
        ...options.filters,
        ...(filterKey ? { [filterKey]: filterValue } : {}),
      },
    });
  const change = <K extends keyof RetrievalOptions>(
    key: K,
    value: RetrievalOptions[K],
  ) => setOptions((prev) => ({ ...prev, [key]: value }));
  return (
    <section className="knowledge-query" aria-label="资料检索">
      <h3>查找资料</h3>
      <label>
        检索方式
        <select
          aria-label="检索方式"
          value={options.strategy}
          disabled={busy}
          onChange={(e) =>
            change("strategy", e.target.value as RetrievalOptions["strategy"])
          }
        >
          <option value="keyword">关键词</option>
          <option value="vector">语义向量</option>
          <option value="hybrid">混合检索</option>
        </select>
      </label>
      <label>
        返回条数
        <input
          aria-label="检索条数"
          type="number"
          min={1}
          max={20}
          value={options.topK}
          disabled={busy}
          onChange={(e) => change("topK", Number(e.target.value))}
        />
      </label>
      <details>
        <summary>检索选项</summary>
        <label>
          最低得分
          <input
            aria-label="最低检索得分"
            type="number"
            min={0}
            max={1}
            step={0.05}
            value={options.minScore}
            disabled={busy}
            onChange={(e) => change("minScore", Number(e.target.value))}
          />
        </label>
        <label>
          候选上限
          <input
            aria-label="检索候选上限"
            type="number"
            min={options.topK}
            max={200}
            value={options.maxCandidates}
            disabled={busy}
            onChange={(e) => change("maxCandidates", Number(e.target.value))}
          />
        </label>
        <label>
          上下文字节预算
          <input
            aria-label="检索上下文预算"
            type="number"
            min={64}
            max={64000}
            value={options.contextBudget}
            disabled={busy}
            onChange={(e) => change("contextBudget", Number(e.target.value))}
          />
        </label>
        <label>
          语义查询超时（毫秒）
          <input
            aria-label="语义查询超时"
            type="number"
            min={50}
            max={120000}
            value={options.timeoutMs}
            disabled={busy}
            onChange={(e) => change("timeoutMs", Number(e.target.value))}
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={options.fallback === "keyword"}
            disabled={busy}
            onChange={(e) =>
              change("fallback", e.target.checked ? "keyword" : "error")
            }
          />
          语义检索失败时改用关键词并显示提示
        </label>
        <label>
          筛选字段
          <input
            aria-label="资料筛选字段"
            value={filterKey}
            disabled={busy}
            onChange={(e) => setFilterKey(e.target.value)}
          />
        </label>
        {Object.keys(options.filters).length > 0 && (
          <p>
            已保存的筛选：{JSON.stringify(options.filters)}{" "}
            <button
              disabled={busy}
              onClick={() => {
                change("filters", {});
                setFilterKey("");
                setFilterValue("");
              }}
            >
              清除筛选
            </button>
          </p>
        )}
        <label>
          筛选值
          <input
            aria-label="资料筛选值"
            value={filterValue}
            disabled={busy}
            onChange={(e) => setFilterValue(e.target.value)}
          />
        </label>
      </details>
      <KnowledgeModelsPanel
        call={call}
        search={search}
        options={options}
        setOptions={setOptions}
        busy={busy}
        version={version}
        run={run}
      />
      <label>
        问题
        <input
          aria-label="资料检索问题"
          value={query}
          disabled={busy}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      <button
        disabled={busy || !query.trim()}
        onClick={() =>
          void run(async (signal) => {
            setResult(undefined);
            const found = await search.query(query, settings(), signal);
            signal.throwIfAborted();
            setResult(found);
          })
        }
      >
        查找资料
      </button>
      <button
        disabled={busy || !canBind}
        onClick={() =>
          void run(async () => {
            onBind(settings());
          })
        }
      >
        用于当前知识积木
      </button>
      {result && (
        <section aria-label="资料检索结果">
          <p>
            {result.status === "no-evidence"
              ? "没有找到可引用资料，请补充资料或明确问题。"
              : `${result.citations.length} 条资料 · ${result.contextBytes} 字节上下文 · ${Math.round(result.elapsedMs)} 毫秒`}
          </p>
          {result.warning && (
            <p role="status">
              {result.warning === "BLK-KNOWLEDGE-KEYWORD-FALLBACK"
                ? "语义检索未完成，本次使用关键词结果。"
                : "更新尚未完成，当前结果来自上次发布的索引。"}
            </p>
          )}
          <KnowledgeCitations
            citations={result.citations}
            projectId={projectId}
            call={call}
          />
        </section>
      )}
    </section>
  );
}
