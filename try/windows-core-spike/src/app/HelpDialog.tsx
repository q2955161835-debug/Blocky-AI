import {
  BookOpen24Regular,
  Dismiss20Regular,
  Info24Regular,
  Keyboard24Regular,
} from "@fluentui/react-icons";
import {
  useEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";

export type HelpView = "quickStart" | "shortcuts" | "about";

interface HelpDialogProps {
  readonly view: HelpView;
  readonly onClose: () => void;
}

const VIEW_META: Readonly<Record<HelpView, {
  readonly title: string;
  readonly icon: ReactNode;
}>> = {
  quickStart: {
    title: "快速开始",
    icon: <BookOpen24Regular aria-hidden="true" />,
  },
  shortcuts: {
    title: "键盘快捷键",
    icon: <Keyboard24Regular aria-hidden="true" />,
  },
  about: {
    title: "关于 Blocky",
    icon: <Info24Regular aria-hidden="true" />,
  },
};

const SHORTCUTS = [
  ["新建 Agent", "Ctrl+N"],
  ["打开 Agent", "Ctrl+O"],
  ["保存", "Ctrl+S"],
  ["另存为", "Ctrl+Shift+S"],
  ["撤销 / 重做", "Ctrl+Z / Ctrl+Y"],
  ["选择 / 平移工具", "V / H"],
  ["全选", "Ctrl+A"],
  ["剪切 / 复制 / 粘贴", "Ctrl+X / Ctrl+C / Ctrl+V"],
  ["删除所选积木", "Delete"],
  ["搜索积木和命令", "Ctrl+P"],
] as const;

function HelpBody({ view }: { readonly view: HelpView }) {
  if (view === "quickStart") {
    return (
      <ol className="help-dialog__steps">
        <li><strong>选择积木</strong><span>从左侧积木库拖到画布，或单击直接插入。</span></li>
        <li><strong>组织流程</strong><span>连接 AI 伙伴、聊天入口和工具积木，搭建 Agent 行为。</span></li>
        <li><strong>测试对话</strong><span>打开“对话测试”，输入消息并按 Enter；发送即运行。</span></li>
        <li><strong>保存文件</strong><span>使用 Ctrl+S 保存为可再次打开的 .blocky 文件。</span></li>
      </ol>
    );
  }
  if (view === "shortcuts") {
    return (
      <dl className="help-dialog__shortcuts">
        {SHORTCUTS.map(([label, shortcut]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd><kbd>{shortcut}</kbd></dd>
          </div>
        ))}
      </dl>
    );
  }
  return (
    <div className="help-dialog__about">
      <strong>Blocky</strong>
      <p>面向创作与教育的积木 AI 生产力工作台。</p>
      <p>通过可视化积木搭建 Agent，并在同一个工作区完成对话测试与本地文件保存。</p>
    </div>
  );
}

export function HelpDialog({ view, onClose }: HelpDialogProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const meta = VIEW_META[view];

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    closeRef.current?.focus();
    return () => previous?.focus();
  }, []);

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      onCloseRef.current();
      return;
    }
    if (event.key !== "Tab") return;
    const controls = [...(rootRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ) ?? [])];
    if (controls.length === 0) return;
    const current = controls.indexOf(document.activeElement as HTMLElement);
    const next = event.shiftKey
      ? current <= 0 ? controls.length - 1 : current - 1
      : current === controls.length - 1 ? 0 : current + 1;
    event.preventDefault();
    controls[next]?.focus();
  };

  return (
    <div className="modal-backdrop">
      <div
        ref={rootRef}
        className="help-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-dialog-title"
        onKeyDown={handleKeyDown}
      >
        <header className="help-dialog__header">
          <span className="help-dialog__icon">{meta.icon}</span>
          <div>
            <span>Blocky 帮助</span>
            <h2 id="help-dialog-title">{meta.title}</h2>
          </div>
          <button
            ref={closeRef}
            type="button"
            className="help-dialog__close"
            aria-label="关闭帮助"
            title="关闭帮助"
            onClick={onClose}
          >
            <Dismiss20Regular aria-hidden="true" />
          </button>
        </header>
        <div className="help-dialog__body">
          <HelpBody view={view} />
        </div>
      </div>
    </div>
  );
}
