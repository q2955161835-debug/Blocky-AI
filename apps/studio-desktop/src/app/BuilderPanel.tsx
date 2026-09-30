import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { resolveSetting } from "@blocky/settings-core";
import { isUserOnlineModel } from "@blocky/resource-registry";
import type { Studio } from "../composition/useStudio";
import type {
  Builder,
  BuilderInput,
  BuilderChatMessage,
} from "../composition/useBuilder";
import "./BuilderChat.css";

const messageStatus: Record<
  NonNullable<BuilderChatMessage["status"]>,
  string
> = {
  proposed: "候选待审阅",
  accepted: "已接受",
  rejected: "已拒绝",
  explained: "已解释",
  failed: "未完成",
  cancelled: "已停止",
  stale: "候选需重新生成",
};

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
  const [intent, setIntent] = useState<BuilderInput["intent"]>("build");
  const [prompt, setPrompt] = useState("");
  const [modeOverride, setMode] = useState<BuilderInput["mode"]>();
  const [resourceOverride, setResourceId] = useState<string>();
  const defaultResourceId = resolveSetting(
    "models.defaultResourceId",
    studio.settings.layers,
  ).value;
  const mode = modeOverride ?? (defaultResourceId ? "live" : "deterministic");
  const resourceId = resourceOverride ?? defaultResourceId;
  const models = [...studio.resources.map.values()].filter(isUserOnlineModel);
  const settingsReady = studio.settings.ready && studio.resources.ready;
  const availableModel = models.some(
    (model) => model.resourceId === resourceId,
  );
  const missingDefault =
    settingsReady &&
    mode === "live" &&
    resourceId === defaultResourceId &&
    !!resourceId &&
    !availableModel;
  const activeWorkspace =
    studio.snapshot.project.workspaces[studio.session.active];
  const result = builder.result;
  const thread = useRef<HTMLDivElement>(null);
  const ready = builder.ready && settingsReady;
  const canSend =
    ready &&
    !builder.busy &&
    !studio.busy &&
    !studio.running &&
    !studio.exiting &&
    !!activeWorkspace &&
    !!prompt.trim() &&
    (mode !== "live" || availableModel);

  useEffect(() => {
    const element = thread.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [builder.messages, builder.busy, builder.result]);

  const submit = () => {
    if (!canSend) return;
    void builder.generate({ intent, prompt, createSurface, mode, resourceId });
    setPrompt("");
  };
  const onComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      event.key !== "Enter" ||
      event.shiftKey ||
      event.nativeEvent.isComposing ||
      event.nativeEvent.keyCode === 229
    )
      return;
    event.preventDefault();
    submit();
  };

  return (
    <section
      className="builder-panel builder-chat-panel"
      aria-label="Blocky 构建助手"
    >
      <header className="builder-chat-header">
        <div>
          <strong>Blocky 构建助手</strong>
          <span>搭建、解释和修复 Agent</span>
        </div>
        <button
          type="button"
          aria-label="新对话"
          disabled={builder.busy}
          onClick={() => {
            builder.newChat();
            setPrompt("");
          }}
        >
          新对话
        </button>
      </header>

      <div className="builder-chat-options">
        <label>
          操作
          <select
            aria-label="构建操作"
            value={intent}
            disabled={builder.busy}
            onChange={(event) =>
              setIntent(event.target.value as BuilderInput["intent"])
            }
          >
            <option value="build">搭建</option>
            <option value="explain">解释所选</option>
            <option value="repair">最小修复</option>
          </select>
        </label>
        <label>
          模型
          <select
            aria-label="构建模型模式"
            value={mode}
            disabled={builder.busy}
            onChange={(event) =>
              setMode(event.target.value as BuilderInput["mode"])
            }
          >
            <option value="deterministic">本地模拟</option>
            <option value="live">已配置模型</option>
          </select>
        </label>
        {mode === "live" && (
          <label className="builder-chat-model-resource">
            模型资源
            <select
              aria-label="构建模型资源"
              value={resourceId}
              disabled={builder.busy}
              onChange={(event) => setResourceId(event.target.value)}
            >
              <option value="">选择已配置模型</option>
              {resourceId && !availableModel && (
                <option value={resourceId} disabled>
                  默认模型不可用
                </option>
              )}
              {models.map((model) => (
                <option key={model.resourceId} value={model.resourceId}>
                  {model.displayName}
                </option>
              ))}
            </select>
          </label>
        )}
        {intent === "build" && (
          <label className="builder-chat-surface-option">
            <input
              type="checkbox"
              checked={createSurface}
              disabled={builder.busy}
              onChange={(event) => setCreateSurface(event.target.checked)}
            />
            生成本地应用界面
          </label>
        )}
      </div>

      {missingDefault && (
        <p role="alert" className="builder-chat-alert">
          默认模型不可用，请在设置中重新选择，或为本次构建选择其他模型。
        </p>
      )}

      <div
        className="builder-chat-thread"
        aria-label="构建助手聊天记录"
        ref={thread}
      >
        {!ready ? (
          <p className="builder-chat-empty" role="status">
            正在恢复对话记录…
          </p>
        ) : builder.messages.length === 0 ? (
          <div className="builder-chat-welcome">
            <strong>你想创建或修改什么？</strong>
            <p>描述目标，构建助手会先生成可审阅的搭建计划。</p>
          </div>
        ) : (
          <ol
            className="builder-chat-messages"
            role="log"
            aria-label="对话消息"
            aria-live="polite"
          >
            {builder.messages.map((message) => (
              <li
                className={`builder-chat-message builder-chat-message-${message.role}`}
                key={message.id}
              >
                <div className="builder-chat-message-heading">
                  <strong>
                    {message.role === "user" ? "你" : "Blocky 构建助手"}
                  </strong>
                  {message.status && (
                    <span>{messageStatus[message.status]}</span>
                  )}
                </div>
                <p>{message.text}</p>
              </li>
            ))}
          </ol>
        )}

        {builder.busy && (
          <p className="builder-chat-progress" role="status">
            {builder.stopping
              ? "正在停止并等待本轮请求结束…"
              : "正在生成并验证候选…"}
          </p>
        )}

        {builder.error && (
          <p role="alert" className="builder-chat-alert">
            {builder.error === "BLK-BUILDER-LOCAL-LIMIT"
              ? "本地模拟不支持此操作，请选择在线模型。"
              : builder.error === "BLK-PATCH-001"
                ? "项目已变化，请重新生成候选。"
                : "构建未完成，原项目保持不变。"}{" "}
            <code>{builder.error}</code>
          </p>
        )}

        {result && (
          <article className="builder-chat-candidate" aria-label="构建方案">
            <div className="builder-chat-candidate-heading">
              <div>
                <span>Blocky 构建助手</span>
                <strong>
                  {result.patch ? "搭建计划 · 候选待审阅" : "搭建计划"}
                </strong>
              </div>
              <span>
                {result.modelApiCalled
                  ? "在线模型"
                  : result.generations.some((g) => g.transport === "local")
                    ? "本地模型"
                    : "本地模拟"}
              </span>
            </div>
            <h3>计划</h3>
            <ol>
              {result.spec.plan.map((line, index) => (
                <li key={index}>{line}</li>
              ))}
            </ol>
            <h3>验证条件</h3>
            <ul>
              {result.spec.acceptanceCriteria.map((line, index) => (
                <li key={index}>{line}</li>
              ))}
            </ul>
            <p className="builder-chat-result-source">
              {result.modelApiCalled ? "已调用在线模型" : "未调用外部模型"} ·{" "}
              {result.generations.length} 次响应
              {result.generations
                .filter((generation) => generation.usage)
                .map((generation, index) => (
                  <span key={`${generation.requestId}-${index}`}>
                    {" "}
                    · {generation.model} · {generation.usage!.totalTokens} Token
                  </span>
                ))}
            </p>
            <details>
              <summary>Build Spec 与来源</summary>
              <pre>{JSON.stringify(result.spec, null, 2)}</pre>
            </details>
            <div className="builder-chat-candidate-actions">
              {result.patch && (
                <button type="button" onClick={review}>
                  审阅候选差异
                </button>
              )}
              <button type="button" onClick={builder.reject}>
                拒绝方案
              </button>
            </div>
          </article>
        )}

        {builder.evidence && (
          <details className="builder-chat-evidence">
            <summary>本次调用记录</summary>
            <p>{builder.evidence.attempts.length} 次调用尝试</p>
            {builder.evidence.attempts.map((attempt) => (
              <p key={attempt.turn}>
                {attempt.response
                  ? `${attempt.response.model} · ${attempt.response.totalTokens} Token · ${attempt.response.responseId}`
                  : "未取得用量"}{" "}
                · {attempt.outcome}
              </p>
            ))}
          </details>
        )}
      </div>

      <form
        className="builder-chat-composer"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <label
          className="builder-chat-prompt-label"
          htmlFor="builder-chat-prompt"
        >
          需求
        </label>
        <textarea
          id="builder-chat-prompt"
          aria-label="构建需求"
          rows={3}
          maxLength={4000}
          value={prompt}
          disabled={builder.busy}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={onComposerKeyDown}
          placeholder="描述你希望这个 Agent 完成的任务"
        />
        <div className="builder-chat-composer-footer">
          <span>Enter 发送 · Shift+Enter 换行</span>
          <div className="builder-chat-composer-actions">
            {builder.busy && (
              <button
                type="button"
                onClick={builder.stop}
                disabled={builder.stopping}
              >
                {builder.stopping ? "正在停止…" : "停止"}
              </button>
            )}
            <button type="submit" aria-label="生成方案" disabled={!canSend}>
              发送
            </button>
          </div>
        </div>
      </form>
    </section>
  );
}
