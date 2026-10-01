import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { resolveSetting } from "@blocky/settings-core";
import { isUserOnlineModel } from "@blocky/resource-registry";
import type { CodingTool, CodingMessage } from "@blocky/builder-protocol";
import type { Studio } from "../composition/useStudio";
import type { CodingAgent } from "../composition/useCodingAgent";
import "./BuilderChat.css";

const status: Record<NonNullable<CodingMessage["status"]>, string> = {
  completed: "已完成",
  proposed: "项目修改待审阅",
  accepted: "已应用",
  rejected: "已舍弃",
  failed: "未完成",
  cancelled: "已停止",
  stale: "候选已过期",
};
const toolNames: Record<CodingTool, string> = {
  workspace_list: "查看文件",
  workspace_search: "搜索代码",
  workspace_read: "读取文件",
  workspace_write: "编辑文件",
  workspace_undo: "撤回修改",
  blocky_cli: "运行 Blocky CLI",
  project_context: "查看项目",
};
function FileDifference({
  before,
  after,
}: {
  before: string | null;
  after: string | null;
}) {
  return (
    <div className="coding-diff">
      <div>
        <span>修改前</span>
        <pre>{before ?? "（新文件）"}</pre>
      </div>
      <div>
        <span>修改后</span>
        <pre>{after ?? "（已删除）"}</pre>
      </div>
    </div>
  );
}
export function BuilderPanel({
  studio,
  builder,
  configureModel,
  promptSuggestion,
}: {
  studio: Studio;
  builder: CodingAgent;
  configureModel(): void;
  promptSuggestion?: { nonce: number; text: string };
}) {
  const [prompt, setPrompt] = useState(""),
    [resourceOverride, setResourceId] = useState<string>();
  const [reviewing, setReviewing] = useState(false),
    [approved, setApproved] = useState<string[]>([]);
  const defaultResourceId = resolveSetting(
    "models.defaultResourceId",
    studio.settings.layers,
  ).value;
  const resourceId = resourceOverride ?? defaultResourceId;
  const models = [...studio.resources.map.values()].filter(isUserOnlineModel);
  const supportsTools = (model: (typeof models)[number]) =>
    Array.isArray(model.definition.capabilities) &&
    model.definition.capabilities.includes("tools");
  const availableModel = models.some(
    (model) => model.resourceId === resourceId && supportsTools(model),
  );
  const unsupportedModel = models.some(
    (model) => model.resourceId === resourceId && !supportsTools(model),
  );
  const ready =
    builder.ready && studio.settings.ready && studio.resources.ready;
  const disabled =
    builder.busy || studio.busy || studio.running || studio.exiting;
  const canSend =
    ready &&
    !disabled &&
    availableModel &&
    !!prompt.trim() &&
    !!studio.snapshot.project.workspaces[studio.session.active];
  const thread = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = thread.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [builder.messages, builder.liveText, builder.events, builder.result]);
  useEffect(() => {
    setReviewing(false);
    setApproved([]);
  }, [builder.result?.requestId]);
  useEffect(() => {
    if (promptSuggestion) setPrompt(promptSuggestion.text);
  }, [promptSuggestion?.nonce]);
  const submit = () => {
    if (!canSend) return;
    void builder.generate({ prompt, resourceId });
    setPrompt("");
  };
  const keyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
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
  const lastTool = [...builder.events].reverse().find((event) => event.tool);
  return (
    <section
      className="builder-panel builder-chat-panel"
      aria-label="Blocky 构建助手"
    >
      <header className="builder-chat-header">
        <div>
          <strong>构建助手</strong>
          <span>编辑代码 · 构建项目</span>
        </div>
        <button
          type="button"
          aria-label="新对话"
          disabled={disabled}
          onClick={() => {
            builder.newChat();
            setPrompt("");
          }}
        >
          新对话
        </button>
      </header>
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
            <span className="coding-welcome-symbol" aria-hidden="true">
              ✦
            </span>
            <strong>你想构建什么？</strong>
            <p>描述目标，或选择文件夹，让助手读取和修改代码。</p>
            <div className="coding-suggestions">
              {[
                "解释当前项目",
                "检查并修复项目问题",
                "为当前项目创建应用界面",
              ].map((text) => (
                <button
                  type="button"
                  key={text}
                  onClick={() => setPrompt(text)}
                >
                  {text}
                </button>
              ))}
            </div>
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
                  <strong>{message.role === "user" ? "你" : "构建助手"}</strong>
                  {message.status && <span>{status[message.status]}</span>}
                </div>
                <p>{message.text}</p>
              </li>
            ))}
          </ol>
        )}
        {builder.liveText && (
          <article
            className="builder-chat-message builder-chat-message-assistant coding-stream"
            aria-label="正在回复"
          >
            <p>{builder.liveText}</p>
          </article>
        )}
        {builder.busy && (
          <p className="builder-chat-progress" role="status">
            {builder.stopping
              ? "正在停止并结算任务…"
              : lastTool?.tool
                ? `${toolNames[lastTool.tool]}${lastTool.kind === "tool.failed" ? " · 未完成" : lastTool.kind === "tool.completed" ? " · 已完成" : "…"}`
                : "正在处理任务…"}
          </p>
        )}
        {builder.events.some((event) => event.tool) && (
          <details className="coding-tool-history">
            <summary>本轮操作</summary>
            <ul>
              {builder.events
                .filter((event) => event.tool && event.kind !== "file.changed")
                .map((event) => (
                  <li key={event.sequence}>
                    {toolNames[event.tool!]} ·{" "}
                    {event.kind === "tool.started"
                      ? "开始"
                      : event.kind === "tool.failed"
                        ? "失败"
                        : "完成"}
                    {event.code && `（${event.code}）`}
                  </li>
                ))}
            </ul>
          </details>
        )}
        {builder.error && (
          <p role="alert" className="builder-chat-alert">
            {builder.error === "BLK-PATCH-001"
              ? "项目已变化，请重新生成项目修改。"
              : builder.error === "BLK-CODING-CONFLICT"
                ? "文件已被其他程序修改，请重新读取后再试。"
                : "任务未完成，请检查模型、文件权限或任务内容。"}{" "}
            <code>{builder.error}</code>
          </p>
        )}
        {builder.changes.length > 0 && (
          <section className="coding-changes" aria-label="文件修改">
            <header>
              <strong>已修改的文件</strong>
              <span>
                {
                  builder.changes.filter(
                    (receipt) => !receipt.undone && !receipt.invalidated,
                  ).length
                }{" "}
                个变更
              </span>
            </header>
            {builder.changes.map(({ change, undone, invalidated }) => (
              <div className="coding-change" key={change.changeId}>
                <div className="coding-change-heading">
                  <span title={change.path}>{change.path}</span>
                  <button
                    type="button"
                    disabled={disabled || undone || invalidated}
                    aria-label={`撤回 ${change.path}`}
                    onClick={() => void builder.undoChange(change.changeId)}
                  >
                    {invalidated ? "回执失效" : undone ? "已撤回" : "撤回"}
                  </button>
                </div>
                <details>
                  <summary>查看差异</summary>
                  <FileDifference before={change.before} after={change.after} />
                </details>
              </div>
            ))}
          </section>
        )}
        {builder.projectReview && (
          <article className="builder-chat-candidate" aria-label="项目修改">
            <strong>项目修改待审阅</strong>
            <p>
              {builder.projectReview.files.length} 个项目文件 ·
              接受后可以整体撤销
            </p>
            <ul className="coding-project-files">
              {builder.projectReview.files.map((file) => (
                <li key={file.path}>{file.path}</li>
              ))}
            </ul>
            <button type="button" onClick={() => setReviewing(!reviewing)}>
              审阅候选差异
            </button>
            {reviewing && (
              <div className="coding-project-review">
                {builder.projectReview.files.map((file) => (
                  <details key={file.path}>
                    <summary>{file.path}</summary>
                    <FileDifference before={file.before} after={file.after} />
                  </details>
                ))}
                {builder.projectReview.permissions.length > 0 && (
                  <fieldset>
                    <legend>新增权限</legend>
                    {builder.projectReview.permissions.map((permission) => (
                      <label key={permission}>
                        <input
                          type="checkbox"
                          checked={approved.includes(permission)}
                          onChange={(event) =>
                            setApproved((values) =>
                              event.target.checked
                                ? [...values, permission]
                                : values.filter(
                                    (value) => value !== permission,
                                  ),
                            )
                          }
                        />
                        {permission}
                      </label>
                    ))}
                  </fieldset>
                )}
                <button
                  type="button"
                  disabled={
                    disabled ||
                    !builder.projectReview.permissions.every((permission) =>
                      approved.includes(permission),
                    )
                  }
                  onClick={() => void builder.applyProject(approved)}
                >
                  接受项目修改
                </button>
              </div>
            )}
            <button type="button" disabled={disabled} onClick={builder.reject}>
              舍弃项目修改
            </button>
          </article>
        )}
      </div>
      {studio.settings.ready && studio.resources.ready && !availableModel && (
        <div role="alert" className="coding-model-guide">
          <span>
            {unsupportedModel
              ? "所选模型未配置工具调用能力，请配置或选择其他模型。"
              : resourceId
                ? "默认模型不可用，请重新选择。"
                : "配置模型后即可开始对话。"}
          </span>
          <button type="button" onClick={configureModel}>
            配置模型
          </button>
        </div>
      )}
      <form
        className="builder-chat-composer"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <div className="coding-context">
          <span title={studio.snapshot.project.manifest.displayName}>
            ◈ {studio.snapshot.project.manifest.displayName}
          </span>
          {studio.selectedRoots.length > 0 && (
            <span>{studio.selectedRoots.length} 个所选积木</span>
          )}
        </div>
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
          maxLength={16000}
          value={prompt}
          disabled={disabled}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={keyDown}
          placeholder="描述任务，助手会读取、编辑并验证…"
        />
        <div className="coding-composer-context">
          <button
            type="button"
            className="coding-workspace-button"
            disabled={disabled}
            onClick={() => void builder.pickWorkspace()}
            title={
              builder.workspace?.displayName ?? "选择允许助手读取和编辑的文件夹"
            }
          >
            {builder.workspace
              ? `▱ ${builder.workspace.displayName}`
              : "＋ 工作文件夹"}
          </button>
          <select
            aria-label="构建模型资源"
            value={resourceId}
            disabled={disabled}
            onChange={(event) => setResourceId(event.target.value)}
          >
            <option value="">选择模型</option>
            {resourceId &&
              !models.some((model) => model.resourceId === resourceId) && (
                <option value={resourceId} disabled>
                  默认模型不可用
                </option>
              )}
            {models.map((model) => (
              <option
                key={model.resourceId}
                value={model.resourceId}
                disabled={!supportsTools(model)}
              >
                {model.displayName}
                {supportsTools(model) ? "" : "（未配置工具调用）"}
              </option>
            ))}
          </select>
        </div>
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
            <button type="submit" aria-label="发送" disabled={!canSend}>
              发送 ↑
            </button>
          </div>
        </div>
      </form>
    </section>
  );
}
