import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { resolveSetting } from "@blocky/settings-core";
import { isUserOnlineModel } from "@blocky/resource-registry";
import type { CodingMessage } from "@blocky/builder-protocol";
import type { Studio } from "../composition/useStudio";
import type { CodingAgent } from "../composition/useCodingAgent";
import {
  ChatMenuButton,
  ChatPopover,
  useChatMenu,
  type ChatMenuControl,
} from "./ChatControls";
import { BuilderModelSettings } from "./BuilderModelSettings";
import "./BuilderChat.css";
import { CodingTrace } from "./CodingTrace";
import { ChatMarkdown } from "./ChatMarkdown";
import { ChatComposer } from "./ChatComposer";
import { useChatFollow } from "./useChatFollow";

const status: Record<NonNullable<CodingMessage["status"]>, string> = {
  completed: "已完成",
  proposed: "项目修改待审阅",
  accepted: "已应用",
  rejected: "已舍弃",
  failed: "未完成",
  cancelled: "已停止",
  stale: "候选已过期",
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
  menu: menuControl,
}: {
  menu?: ChatMenuControl;
  studio: Studio;
  builder: CodingAgent;
  configureModel(): void;
  promptSuggestion?: { nonce: number; text: string };
}) {
  const menu = useChatMenu(menuControl);
  const [prompt, setPrompt] = useState(""),
    [resourceOverride, setResourceId] = useState<string>();
  const [reviewing, setReviewing] = useState(false);
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
  const ready =
    builder.ready && studio.settings.ready && studio.resources.ready;
  const disabled =
    builder.busy || studio.busy || studio.running || studio.exiting;
  const canSend =
    ready &&
    !disabled &&
    !!prompt.trim() &&
    !!studio.snapshot.project.workspaces[studio.session.active];
  const thread = useChatFollow(
    builder.activeChatId ?? studio.snapshot.project.manifest.projectId,
    [builder.messages, builder.liveText, builder.events, builder.result],
  );
  const previousChat = useRef(builder.activeChatId);
  useEffect(() => {
    if (previousChat.current && previousChat.current !== builder.activeChatId)
      setPrompt("");
    previousChat.current = builder.activeChatId;
  }, [builder.activeChatId]);
  useEffect(() => {
    setReviewing(false);
  }, [builder.result?.requestId]);
  useEffect(() => {
    if (promptSuggestion) setPrompt(promptSuggestion.text);
  }, [promptSuggestion?.nonce]);
  const submit = () => {
    if (!canSend) return;
    if (!availableModel) {
      menu.set("settings");
      return;
    }
    menu.set(null);
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
  return (
    <section
      className="builder-panel builder-chat-panel chat-panel"
      aria-label="Blocky 构建助手"
    >
      <div
        className="builder-chat-thread"
        aria-label="构建助手聊天记录"
        ref={thread.ref}
        onScroll={thread.onScroll}
      >
        {!ready ? (
          <p className="builder-chat-empty" role="status">
            正在恢复对话记录…
          </p>
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
                {message.role === "assistant" ? (
                  <ChatMarkdown text={message.text} />
                ) : (
                  <p>{message.text}</p>
                )}
              </li>
            ))}
          </ol>
        )}
        {builder.liveText && (
          <article
            className="builder-chat-message builder-chat-message-assistant coding-stream"
            aria-label="正在回复"
          >
            <ChatMarkdown text={builder.liveText} />
          </article>
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
            <strong>
              {builder.projectReview.status === "applied"
                ? "项目修改已自动应用"
                : builder.projectReview.status === "conflict"
                  ? "项目已变化，候选修改已保留"
                  : "候选修改未能应用，内容已保留"}
            </strong>
            <p>
              {builder.projectReview.files.length} 个项目文件 ·
              {builder.projectReview.status === "applied"
                ? "可整体撤销"
                : "未覆盖当前画布"}
            </p>
            <ul className="coding-project-files">
              {builder.projectReview.files.map((file) => (
                <li key={file.path}>{file.path}</li>
              ))}
            </ul>
            {builder.projectReview.permissions.length > 0 && (
              <div>
                <strong>新增声明权限</strong>
                <ul>
                  {builder.projectReview.permissions.map((permission) => (
                    <li key={permission}>{permission}</li>
                  ))}
                </ul>
                <p>Host 实际可用能力仍由现有安全策略控制。</p>
              </div>
            )}
            {builder.projectReview.error && (
              <p role="status">
                {builder.projectReview.error} · 候选保留，可查看差异。
              </p>
            )}
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
              </div>
            )}
            {builder.projectReview.status !== "applied" && (
              <button
                type="button"
                disabled={disabled}
                onClick={builder.reject}
              >
                舍弃项目修改
              </button>
            )}
          </article>
        )}
      </div>
      <CodingTrace events={builder.events} busy={builder.busy} stopping={builder.stopping} />
      <ChatPopover menu={menu} kind="add" label="构建助手上下文">
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            menu.set(null);
            void builder.pickWorkspace();
          }}
        >
          选择工作文件夹
        </button>
        {builder.workspace && (
          <p>工作文件夹：{builder.workspace.displayName}</p>
        )}
        <p>当前项目：{studio.snapshot.project.manifest.displayName}</p>
        {studio.selectedRoots.length > 0 && (
          <p>{studio.selectedRoots.length} 个所选积木</p>
        )}
      </ChatPopover>
      <ChatPopover menu={menu} kind="settings" label="构建助手设置">
        <BuilderModelSettings
          studio={studio}
          resourceId={resourceId}
          disabled={disabled}
          select={setResourceId}
          configure={() => {
            menu.set(null);
            configureModel();
          }}
        />
      </ChatPopover>
      <ChatComposer
        id="builder-chat-prompt"
        label="构建需求"
        maxLength={16000}
        value={prompt}
        disabled={disabled}
        onChange={setPrompt}
        onSubmit={submit}
        onKeyDown={keyDown}
        placeholder="描述要构建的内容"
      >
        <ChatMenuButton menu={menu} kind="add" label="构建助手添加上下文">
          ＋
        </ChatMenuButton>
        <span className="chat-model-chip">
          <span className="chat-model-name">
            {models.find((model) => model.resourceId === resourceId)
              ?.displayName ?? "选择模型"}
          </span>
        </span>
        {builder.workspace && (
          <span
            className="chat-context-marker"
            title={builder.workspace.displayName}
            aria-label={`工作文件夹：${builder.workspace.displayName}`}
          >
            ▱
          </span>
        )}
        <span className="chat-toolbar-spacer" />
        {builder.busy ? (
          <button
            className="chat-icon"
            type="button"
            aria-label={builder.stopping ? "正在停止" : "停止"}
            title="停止"
            disabled={builder.stopping}
            onClick={builder.stop}
          >
            ■
          </button>
        ) : (
          <button
            className="chat-send"
            type="submit"
            aria-label="发送"
            title="发送"
            disabled={!canSend}
          >
            ↑
          </button>
        )}
      </ChatComposer>
    </section>
  );
}
