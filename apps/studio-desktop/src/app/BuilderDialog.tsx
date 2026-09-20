import { useEffect, useRef, useState } from "react";
import type { Studio } from "../composition/useStudio";
import type { Builder, BuilderInput } from "../composition/useBuilder";
export function BuilderDialog({
  studio,
  builder,
  createSurface,
  review,
  close,
}: {
  studio: Studio;
  builder: Builder;
  createSurface: boolean;
  review(): void;
  close(): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [intent, setIntent] = useState<BuilderInput["intent"]>("build"),
    [prompt, setPrompt] = useState(""),
    [surface, setSurface] = useState(createSurface),
    [mode, setMode] = useState<BuilderInput["mode"]>("deterministic"),
    [resourceId, setResourceId] = useState("");
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const models = [...studio.resources.map.values()].filter(
    (r) =>
      r.kind === "model" &&
      r.scope === "user" &&
      r.definition.provider === "deepseek",
  );
  const dismiss = () => {
    builder.clear();
    close();
  };
  const result = builder.result;
  return (
    <dialog
      ref={dialog}
      className="popup construction-dialog builder-dialog"
      aria-label="Blocky 构建助手"
      onCancel={(e) => {
        e.preventDefault();
        dismiss();
      }}
    >
      <header>
        <strong>Blocky 构建助手</strong>
        <button aria-label="关闭构建助手" onClick={dismiss}>
          ×
        </button>
      </header>
      <div className="settings">
        <label>
          操作
          <select
            aria-label="构建操作"
            value={intent}
            disabled={builder.busy}
            onChange={(e) => {
              builder.clear();
              setIntent(e.target.value as BuilderInput["intent"]);
            }}
          >
            <option value="build">搭建</option>
            <option value="explain">解释所选</option>
            <option value="repair">最小修复</option>
          </select>
        </label>
        <label>
          需求
          <textarea
            aria-label="构建需求"
            rows={4}
            maxLength={16000}
            value={prompt}
            disabled={builder.busy}
            onChange={(e) => {
              builder.clear();
              setPrompt(e.target.value);
            }}
            placeholder="描述你希望这个 Agent 完成的任务"
          />
        </label>
        <label>
          模型
          <select
            aria-label="构建模型模式"
            value={mode}
            disabled={builder.busy}
            onChange={(e) => {
              builder.clear();
              setMode(e.target.value as BuilderInput["mode"]);
            }}
          >
            <option value="deterministic">本地模拟</option>
            <option value="live">在线模型</option>
          </select>
        </label>
        {mode === "live" && (
          <label>
            模型资源
            <select
              aria-label="构建模型资源"
              value={resourceId}
              disabled={builder.busy}
              onChange={(e) => {
                builder.clear();
                setResourceId(e.target.value);
              }}
            >
              <option value="">选择已配置模型</option>
              {models.map((r) => (
                <option key={r.resourceId} value={r.resourceId}>
                  {r.displayName}
                </option>
              ))}
            </select>
          </label>
        )}
        {mode === "deterministic" && (
          <p className="muted">
            本地模拟支持角色调整和选择解释，不调用外部模型。
          </p>
        )}
        {intent === "build" && (
          <label>
            <input
              type="checkbox"
              checked={surface}
              disabled={builder.busy}
              onChange={(e) => {
                builder.clear();
                setSurface(e.target.checked);
              }}
            />
            为这个 Agent 创建应用界面，仅本地预览
          </label>
        )}
        <div className="actions">
          <button
            disabled={
              builder.busy || !prompt.trim() || (mode === "live" && !resourceId)
            }
            onClick={() =>
              void builder.generate({
                intent,
                prompt,
                createSurface: surface,
                mode,
                resourceId,
              })
            }
          >
            生成方案
          </button>
          {builder.busy && <button onClick={builder.clear}>停止</button>}
        </div>
        {builder.busy && <p role="status">正在生成并验证候选…</p>}
        {builder.error && (
          <p role="alert">
            {builder.error === "BLK-BUILDER-LOCAL-LIMIT"
              ? "本地模拟不支持此操作，请选择在线模型。"
              : builder.error === "BLK-PATCH-001"
                ? "项目已变化，请重新生成候选。"
                : "构建未完成，原项目保持不变。"}{" "}
            <code>{builder.error}</code>
          </p>
        )}
        {result && (
          <section aria-label="构建方案">
            <h3>搭建计划</h3>
            <ol>
              {result.spec.plan.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ol>
            <h3>验证条件</h3>
            <ul>
              {result.spec.acceptanceCriteria.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
            {result.explanation && (
              <p style={{ whiteSpace: "pre-wrap" }}>{result.explanation}</p>
            )}
            <p>
              {result.modelApiCalled ? "已调用在线模型" : "未调用外部模型"} ·{" "}
              {result.generations.length} 次响应
            </p>
            {result.generations
              .filter((g) => g.usage)
              .map((g, i) => (
                <p key={i}>
                  {g.model} · {g.usage!.totalTokens} Token
                </p>
              ))}
            <details>
              <summary>Build Spec 与来源</summary>
              <pre>{JSON.stringify(result.spec, null, 2)}</pre>
            </details>
            <div className="actions">
              {result.patch && <button onClick={review}>审阅候选差异</button>}
              <button onClick={builder.clear}>拒绝方案</button>
            </div>
          </section>
        )}
      </div>
    </dialog>
  );
}
