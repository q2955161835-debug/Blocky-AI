import {
  useEffect,
  useEffectEvent,
  useId,
  useRef,
  useState,
  type ReactNode,
  type CSSProperties,
} from "react";

export type ChatMenu = "add" | "settings" | "history" | "model" | null;
export type ChatMenuControl = { value: ChatMenu; set(value: ChatMenu): void };

export function useChatMenu(control?: ChatMenuControl): ChatMenuControl {
  const [value, set] = useState<ChatMenu>(null);
  return control ?? { value, set };
}

/** The application supplies its shared popup state; isolated panels may own it. */
export function ChatPopover({
  menu,
  kind,
  label,
  children,
  style,
  className,
}: {
  menu: ChatMenuControl;
  kind: Exclude<ChatMenu, null>;
  label: string;
  children: ReactNode;
  style?: CSSProperties;
  className?: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const open = menu.value === kind;
  const close = useEffectEvent(() => menu.set(null));
  useEffect(() => {
    if (!open) return;
    previousFocus.current = document.activeElement as HTMLElement | null;
    root.current
      ?.querySelector<HTMLElement>(
        "button:not(:disabled),select:not(:disabled),input:not(:disabled)",
      )
      ?.focus();
    const outside = (event: PointerEvent) => {
      const target = event.target;
      if (
        !(target instanceof Element) ||
        root.current?.contains(target) ||
        target.closest("[data-chat-trigger]")
      )
        return;
      close();
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  return (
    <div
      ref={root}
      hidden={!open}
      className={`chat-popover${className ? ` ${className}` : ""}`}
      style={style}
      data-chat-kind={kind}
      role="dialog"
      aria-labelledby={titleId}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        menu.set(null);
        previousFocus.current?.focus();
      }}
    >
      <div className="chat-popover-header">
        <strong id={titleId}>{label}</strong>
        <button
          type="button"
          aria-label={`关闭${label}`}
          onClick={() => {
            menu.set(null);
            previousFocus.current?.focus();
          }}
        >
          ×
        </button>
      </div>
      <div className="chat-popover-content">{children}</div>
    </div>
  );
}

export function ChatMenuButton({
  menu,
  kind,
  label,
  children,
  className,
}: {
  menu: ChatMenuControl;
  kind: Exclude<ChatMenu, null>;
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={className ?? "chat-icon"}
      data-chat-trigger
      aria-label={label}
      title={label}
      aria-haspopup="dialog"
      aria-expanded={menu.value === kind}
      onClick={(event) => {
        event.currentTarget.focus();
        menu.set(menu.value === kind ? null : kind);
      }}
    >
      {children}
    </button>
  );
}
