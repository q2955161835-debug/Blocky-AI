import { useState } from "react";
import { resolveSetting } from "@blocky/settings-core";
import { isUserOnlineModel } from "@blocky/resource-registry";
import type { Studio } from "../composition/useStudio";
import type { Builder, BuilderInput } from "../composition/useBuilder";
export function BuilderPanel({
  studio,
  builder,
  createSurface,
  setCreateSurface,
  review,
}: {
  studio: Studio;
  builder: Builder;
  createSurface: boolean;
  setCreateSurface(value: boolean): void;
  review(): void;
}) {
  const [intent, setIntent] = useState<BuilderInput["intent"]>("build"),
    [prompt, setPrompt] = useState(""),
    [modeOverride, setMode] = useState<BuilderInput["mode"]>(),
    [resourceOverride, setResourceId] = useState<string>();
  const defaultResourceId = resolveSetting(
    "models.defaultResourceId",
    studio.settings.layers,
  ).value;
  const mode = modeOverride ?? (defaultResourceId ? "live" : "deterministic");
  const resourceId = resourceOverride ?? defaultResourceId;
  const models = [...studio.resources.map.values()].filter(isUserOnlineModel);
  const ready = studio.settings.ready && studio.resources.ready;
  const availableModel = models.some(
    (model) => model.resourceId === resourceId,
  );
  const missingDefault =
    ready &&
    mode === "live" &&
    resourceId === defaultResourceId &&
    !!resourceId &&
    !availableModel;
  const result = builder.result;
  return (
    <section className="builder-panel" aria-label="Blocky 构建助手">
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
              {resourceId && !availableModel && (
                <option value={resourceId} disabled>
                  默认模型不可用
                </option>
              )}
              {models.map((r) => (
                <option key={r.resourceId} value={r.resourceId}>
                  {r.displayName}
                </option>
              ))}
            </select>
          </label>
        )}
        {missingDefault && (
          <p role="alert">
            默认模型不可用，请在设置中重新选择，或为本次构建选择其他模型。
          </p>
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
              checked={createSurface}
              disabled={builder.busy}
              onChange={(e) => {
                builder.clear();
                setCreateSurface(e.target.checked);
              }}
            />
            为这个 Agent 创建应用界面，仅本地预览
          </label>
        )}
        <div className="actions">
          <button
            disabled={
              builder.busy ||
              studio.busy ||
              studio.running ||
              studio.exiting ||
              !studio.snapshot.project.workspaces[studio.session.active] ||
              !ready ||
              !prompt.trim() ||
              (mode === "live" && !availableModel)
            }
            onClick={() =>
              void builder.generate({
                intent,
                prompt,
                createSurface,
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
        {builder.evidence && (
          <details>
            <summary>本次调用记录</summary>
            <p>{builder.evidence.attempts.length} 次调用尝试</p>
            {builder.evidence.attempts.map((a) => (
              <p key={a.turn}>
                {a.response
                  ? `${a.response.model} · ${a.response.totalTokens} Token · ${a.response.responseId}`
                  : "未取得用量"}{" "}
                · {a.outcome}
              </p>
            ))}
          </details>
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
    </section>
  );
}
