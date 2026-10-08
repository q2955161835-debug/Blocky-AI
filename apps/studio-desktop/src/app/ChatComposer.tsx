import {
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEventHandler,
  type ReactNode,
} from "react";
import { ResizeHandle } from "./ResizeHandle";
import "./ChatLayout.css";

const MIN_TEXTAREA_HEIGHT = 54;
const HANDLE_HEIGHT = 8;
const TOOLBAR_HEIGHT = 28;

export function ChatComposer({
  value,
  onChange,
  onSubmit,
  onKeyDown,
  label,
  placeholder,
  disabled = false,
  maxLength,
  id,
  children,
}: {
  value: string;
  onChange(value: string): void;
  onSubmit(): void;
  onKeyDown?: KeyboardEventHandler<HTMLTextAreaElement>;
  label: string;
  placeholder: string;
  disabled?: boolean;
  maxLength?: number;
  id?: string;
  children: ReactNode;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [toolbarHeight, setToolbarHeight] = useState(TOOLBAR_HEIGHT);
  const [panelHeight, setPanelHeight] = useState(0);
  const [manualHeight, setManualHeight] = useState<number | null>(null);
  const [contentHeight, setContentHeight] = useState(MIN_TEXTAREA_HEIGHT);

  useLayoutEffect(() => {
    const form = formRef.current;
    const panel = form?.closest<HTMLElement>(".chat-panel");
    if (!panel) return;

    const measure = () => {
      const nextHeight =
        panel.getBoundingClientRect().height || panel.clientHeight || 0;
      setPanelHeight((current) =>
        current === nextHeight ? current : nextHeight,
      );
      const height =
        toolbarRef.current?.getBoundingClientRect().height ||
        toolbarRef.current?.clientHeight ||
        TOOLBAR_HEIGHT;
      setToolbarHeight((current) =>
        current === height ? current : Math.max(TOOLBAR_HEIGHT, height),
      );
    };

    measure();
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(measure);
    observer?.observe(panel);
    if (toolbarRef.current) observer?.observe(toolbarRef.current);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  const formChromeHeight = 2 + 7 + HANDLE_HEIGHT + toolbarHeight;
  const defaultFormHeight = formChromeHeight + MIN_TEXTAREA_HEIGHT;
  const maxHeight =
    panelHeight > 0
      ? Math.max(defaultFormHeight, Math.floor(panelHeight * 0.4))
      : null;
  const minHeight = Math.min(defaultFormHeight, maxHeight ?? defaultFormHeight);
  const maxDragHeight = Math.max(
    minHeight,
    maxHeight ?? Number.MAX_SAFE_INTEGER,
  );

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const previousScrollTop = textarea.scrollTop;
    textarea.style.height = "auto";
    const nextContentHeight = Math.max(
      MIN_TEXTAREA_HEIGHT,
      textarea.scrollHeight,
    );
    const preferredHeight = Math.max(minHeight, manualHeight ?? minHeight);
    const naturalHeight = value
      ? Math.max(preferredHeight, formChromeHeight + nextContentHeight)
      : preferredHeight;
    const nextFormHeight = Math.min(maxHeight ?? naturalHeight, naturalHeight);
    textarea.style.height = `${Math.max(0, nextFormHeight - formChromeHeight)}px`;

    if (document.activeElement === textarea) {
      if (
        textarea.selectionStart === value.length &&
        textarea.selectionEnd === value.length
      ) {
        textarea.scrollTop = textarea.scrollHeight;
      } else {
        textarea.scrollTop = previousScrollTop;
      }
    }

    setContentHeight((current) =>
      current === nextContentHeight ? current : nextContentHeight,
    );
  }, [
    manualHeight,
    maxHeight,
    minHeight,
    panelHeight,
    formChromeHeight,
    value,
  ]);

  const preferredHeight = Math.max(minHeight, manualHeight ?? minHeight);
  const naturalHeight = value
    ? Math.max(preferredHeight, formChromeHeight + contentHeight)
    : preferredHeight;
  const formHeight = Math.min(maxHeight ?? naturalHeight, naturalHeight);
  const textareaHeight = Math.max(0, formHeight - formChromeHeight);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!disabled) onSubmit();
  };

  return (
    <form
      ref={formRef}
      className="chat-composer chat-composer--resizable"
      aria-label={`${label}输入区`}
      onSubmit={submit}
      style={{
        height: `${formHeight}px`,
        ...(maxHeight === null ? {} : { maxHeight: `${maxHeight}px` }),
      }}
    >
      <ResizeHandle
        className="chat-composer-resize"
        label="调整聊天输入框高度"
        axis="y"
        reverse
        min={minHeight}
        max={maxDragHeight}
        value={formHeight}
        onChange={setManualHeight}
      />
      <textarea
        ref={textareaRef}
        id={id}
        className="chat-composer-input"
        aria-label={label}
        rows={2}
        maxLength={maxLength}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        style={{ height: `${textareaHeight}px`, resize: "none" }}
      />
      <div className="chat-composer-toolbar" ref={toolbarRef}>
        {children}
      </div>
    </form>
  );
}
