import {
  BotAdd20Regular,
  BookOpen20Regular,
  ChatAdd20Regular,
} from "@fluentui/react-icons";

interface BuilderAssistantProps {
  readonly hasAgent: boolean;
  readonly hasChatEntry: boolean;
  readonly onAddAgent: () => void;
  readonly onAddChatEntry: () => void;
  readonly onOpenQuickStart: () => void;
}

export function BuilderAssistant({
  hasAgent,
  hasChatEntry,
  onAddAgent,
  onAddChatEntry,
  onOpenQuickStart,
}: BuilderAssistantProps) {
  return (
    <section className="builder-assistant" aria-label="搭建助手">
      <header>
        <strong>下一步</strong>
        <p>从画布当前状态继续搭建，不会自动修改已有积木。</p>
      </header>
      <div className="builder-assistant__actions">
        {!hasAgent ? (
          <button type="button" onClick={onAddAgent}>
            <BotAdd20Regular aria-hidden="true" />
            <span>添加 AI 伙伴</span>
          </button>
        ) : null}
        {!hasChatEntry ? (
          <button type="button" onClick={onAddChatEntry}>
            <ChatAdd20Regular aria-hidden="true" />
            <span>添加聊天入口</span>
          </button>
        ) : null}
        <button type="button" onClick={onOpenQuickStart}>
          <BookOpen20Regular aria-hidden="true" />
          <span>打开快速入门</span>
        </button>
      </div>
    </section>
  );
}
