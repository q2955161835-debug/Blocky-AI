import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { resolveSetting } from "@blocky/settings-core";
import { isUserOnlineModel } from "@blocky/resource-registry";
import type { CodingTool, CodingMessage } from "@blocky/builder-protocol";
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
  const ready =
    builder.ready && studio.settings.ready && studio.resources.ready;
  const disabled =
    builder.busy || studio.busy || studio.running || studio.exiting;
  const canSend =
    ready &&
    !disabled &&
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
  const lastTool = [...builder.events].reverse().find((event) => event.tool);
  return (
    <section
      className="builder-panel builder-chat-panel chat-panel"
      aria-label="Blocky 构建助手"
    >
      <div className="chat-panel-header">
        <button
          className="chat-icon"
          type="button"
          aria-label="新对话"
          title="新对话"
          disabled={disabled}
          onClick={() => {
            builder.newChat();
            setPrompt("");
            menu.set(null);
          }}
        >
          ＋
        </button>
        <ChatMenuButton menu={menu} kind="settings" label="构建助手设置">
          ⚙
        </ChatMenuButton>
      </div>
      <div
        className="builder-chat-thread"
        aria-label="构建助手聊天记录"
        ref={thread}
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
      <form
        className="builder-chat-composer chat-composer"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <textarea
          id="builder-chat-prompt"
          aria-label="构建需求"
          rows={2}
          maxLength={16000}
          value={prompt}
          disabled={disabled}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={keyDown}
          placeholder="描述要构建的内容"
          title="Enter 发送 · Shift+Enter 换行"
        />
        <div className="chat-composer-toolbar">
          <ChatMenuButton menu={menu} kind="add" label="构建助手添加上下文">
            ＋
          </ChatMenuButton>
          <ChatMenuButton
            menu={menu}
            kind="settings"
            label="选择构建模型"
            className="chat-model-chip"
          >
            <span className="chat-model-name">{models.find((model) => model.resourceId === resourceId)
              ?.displayName ?? "选择模型"}</span>
            <span aria-hidden="true">⌄</span>
          </ChatMenuButton>
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
        </div>
      </form>
    </section>
  );
}
