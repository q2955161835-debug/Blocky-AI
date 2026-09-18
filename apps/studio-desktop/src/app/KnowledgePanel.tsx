import { useEffect, useMemo, useRef, useState } from "react";
import {
  knowledgePort,
  readKnowledgeState,
  synchronize,
  type KnowledgeCall,
  type SourceSummary,
} from "@blocky/knowledge-core";
export function KnowledgePanel({
  projectId,
  collectionId,
  call,
  onBind,
}: {
  projectId: string;
  collectionId: string;
  call: KnowledgeCall;
  onBind: () => void;
}) {
  const port = useMemo(
    () => knowledgePort(call, projectId, collectionId),
    [call, projectId, collectionId],
  );
  const [sources, setSources] = useState<SourceSummary[]>([]),
    [status, setStatus] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [url, setUrl] = useState("");
  const pending = useRef<AbortController | null>(null),
    epoch = useRef(0);
  const refresh = async () => {
    const current = epoch.current;
    const listed = await port.sources(),
      stored = await port.load();
    if (current !== epoch.current) return;
    const state = readKnowledgeState(stored.value);
    setSources(listed.sources);
    setStatus(
      `${state.index?.documents.length ?? 0} 份文档 · ${state.index?.chunks.length ?? 0} 个片段${state.pending?.failures.length ? ` · ${state.pending.failures.length} 个来源失败，尚未发布更新` : ""}`,
    );
  };
  useEffect(() => {
    const current = ++epoch.current;
    void refresh().catch(() => {
      if (current === epoch.current)
        setError("资料状态无法读取，请检查来源权限后重试。");
    });
    return () => {
      epoch.current++;
      if (pending.current) {
        pending.current.abort();
        void call("knowledge-cancel", { projectId, collectionId }).catch(
          () => {},
        );
      }
    };
  }, [port]);
  const run = async (work: (signal: AbortSignal) => Promise<void>) => {
    if (pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setError("");
    const current = epoch.current;
    try {
      await work(controller.signal);
      if (current === epoch.current) await refresh();
    } catch {
      if (current === epoch.current)
        setError(
          controller.signal.aborted
            ? "同步已取消，可重新同步继续。"
            : "资料操作未完成，请检查来源、权限和同步状态。",
        );
    } finally {
      pending.current = null;
      if (current === epoch.current) setBusy(false);
    }
  };
  const change = (operation: string, fields: Record<string, unknown>) =>
    call(operation, { projectId, collectionId, ...fields });
  return (
    <section className="knowledge-panel" aria-label="知识来源">
      <h3>知识来源</h3>
      <div className="knowledge-actions">
        {(["file", "directory", "repository"] as const).map((kind, i) => (
          <button
            key={kind}
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await change("knowledge-source-add", { kind });
              })
            }
          >
            {["添加文件", "添加文件夹", "添加仓库"][i]}
          </button>
        ))}
      </div>
      <label>
        网页地址
        <input
          aria-label="资料网页地址"
          value={url}
          disabled={busy}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://…"
        />
      </label>
      <button
        disabled={busy || !url.trim()}
        onClick={() =>
          void run(async () => {
            await change("knowledge-source-add", { kind: "url", url });
            setUrl("");
          })
        }
      >
        添加网页
      </button>
      <ul>
        {sources.map((source) => (
          <li key={source.sourceId}>
            <span>{source.title}</span>{" "}
            <small>{source.readable ? "允许本机读取" : "已禁止读取"}</small>
            <button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await change("knowledge-source-acl", {
                    sourceId: source.sourceId,
                    allowedPrincipals: source.readable ? [] : ["local-user"],
                  });
                })
              }
            >
              {source.readable ? "禁止读取" : "允许读取"}
            </button>
            <button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await change("knowledge-source-remove", {
                    sourceId: source.sourceId,
                  });
                })
              }
            >
              移除来源
            </button>
          </li>
        ))}
      </ul>
      <p role="status">{status}</p>
      {error && <p role="alert">{error}</p>}
      <button
        disabled={busy}
        onClick={() =>
          void run(async (signal) => {
            const result = await synchronize(port, {
              signal,
              onProgress: (c) =>
                setStatus(
                  `正在同步 · ${c.added + c.updated + c.skipped} 份文档`,
                ),
            });
            if (result.status === "failed")
              setError("部分来源失败，未发布新索引。修复后可继续同步。");
          })
        }
      >
        同步资料
      </button>
      {busy && (
        <button
          onClick={() => {
            pending.current?.abort();
            void change("knowledge-cancel", {}).catch(() => {});
          }}
        >
          停止同步
        </button>
      )}
      <button
        disabled={busy || !sources.some((s) => s.readable)}
        onClick={onBind}
      >
        用于当前知识积木
      </button>
    </section>
  );
}
