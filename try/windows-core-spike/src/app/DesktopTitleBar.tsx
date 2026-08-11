import {
  ArrowRedo20Regular,
  ArrowUndo20Regular,
  Dismiss20Regular,
  PanelLeft20Regular,
  PanelRight20Regular,
  Square20Regular,
  Subtract20Regular,
} from "@fluentui/react-icons";
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import blockyLogoUrl from "../../../../logo/logo.png";
import type { WindowChromeBridge } from "./WindowChromeBridge";

type MenuId = "file" | "edit" | "view" | "help";

export interface DesktopTitleBarProps {
  readonly projectTitle: string;
  readonly leftCollapsed: boolean;
  readonly rightCollapsed: boolean;
  readonly onToggleLeft: () => void;
  readonly onToggleRight: () => void;
  readonly onUndo: () => void;
  readonly onRedo: () => void;
  readonly onSave: () => void;
  readonly onLoad: () => void;
  readonly onClear: () => void;
  readonly onFit: () => void;
  readonly onLoadFixture: () => void;
  readonly windowChrome: WindowChromeBridge;
  readonly extraViewAction?: Readonly<{ label: string; run: () => void }>;
}

interface MenuAction {
  readonly label: string;
  readonly run: () => void;
}

function IconButton({
  label,
  children,
  pressed,
  onClick,
  className = "",
}: {
  readonly label: string;
  readonly children: ReactNode;
  readonly pressed?: boolean;
  readonly onClick: () => void;
  readonly className?: string;
}) {
  return (
    <button
      type="button"
      className={`titlebar-icon-button ${className}`.trim()}
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function DesktopTitleBar({
  projectTitle,
  leftCollapsed,
  rightCollapsed,
  onToggleLeft,
  onToggleRight,
  onUndo,
  onRedo,
  onSave,
  onLoad,
  onClear,
  onFit,
  onLoadFixture,
  windowChrome,
  extraViewAction,
}: DesktopTitleBarProps) {
  const [openMenu, setOpenMenu] = useState<MenuId | null>(null);
  const [aboutOpen, setAboutOpen] = useState(false);
  const rootRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const closeOnPointerDown = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpenMenu(null);
    };
    const closeOnEscape = (event: globalThis.KeyboardEvent): void => {
      if (event.key === "Escape") {
        setOpenMenu(null);
        setAboutOpen(false);
      }
    };
    document.addEventListener("pointerdown", closeOnPointerDown);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointerDown);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  const menuActions: Record<MenuId, readonly MenuAction[]> = {
    file: [
      { label: "保存", run: onSave },
      { label: "重开", run: onLoad },
      { label: "清空", run: onClear },
    ],
    edit: [
      { label: "撤销", run: onUndo },
      { label: "重做", run: onRedo },
    ],
    view: [
      {
        label: leftCollapsed ? "展开积木栏" : "收起积木栏",
        run: onToggleLeft,
      },
      {
        label: rightCollapsed ? "展开运行栏" : "收起运行栏",
        run: onToggleRight,
      },
      { label: "适配画布", run: onFit },
      { label: "载入100块", run: onLoadFixture },
      ...(extraViewAction
        ? [{ label: extraViewAction.label, run: extraViewAction.run }]
        : []),
    ],
    help: [
      {
        label: "关于 Windows Core 技术尖峰",
        run: () => setAboutOpen(true),
      },
    ],
  };

  const menuLabels: Record<MenuId, string> = {
    file: "文件",
    edit: "编辑",
    view: "视图",
    help: "帮助",
  };

  const runAndClose = (action: MenuAction): void => {
    setOpenMenu(null);
    action.run();
  };

  const handleMenuKeys = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>(
      '[role="menuitem"]',
    )];
    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
    let nextIndex: number | null = null;
    if (event.key === "ArrowDown") nextIndex = (currentIndex + 1) % items.length;
    if (event.key === "ArrowUp") {
      nextIndex = (currentIndex - 1 + items.length) % items.length;
    }
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = items.length - 1;
    if (nextIndex !== null) {
      event.preventDefault();
      items[nextIndex]?.focus();
    }
  };

  return (
    <header ref={rootRef} className="desktop-titlebar" aria-label="应用标题栏">
      <div className="desktop-titlebar__brand">
        <img src={blockyLogoUrl} alt="" />
        <strong>Blocky</strong>
      </div>

      <div className="desktop-titlebar__primary-actions">
        <IconButton
          label={leftCollapsed ? "展开积木栏" : "收起积木栏"}
          pressed={leftCollapsed}
          onClick={onToggleLeft}
        >
          <PanelLeft20Regular aria-hidden="true" />
        </IconButton>
        <span className="titlebar-separator" aria-hidden="true" />
        <IconButton label="撤销" onClick={onUndo}>
          <ArrowUndo20Regular aria-hidden="true" />
        </IconButton>
        <IconButton label="重做" onClick={onRedo}>
          <ArrowRedo20Regular aria-hidden="true" />
        </IconButton>
      </div>

      <nav className="desktop-titlebar__menus" aria-label="应用菜单">
        {(Object.keys(menuLabels) as MenuId[]).map((menuId) => (
          <div className="titlebar-menu" key={menuId}>
            <button
              type="button"
              aria-haspopup="menu"
              aria-expanded={openMenu === menuId}
              onClick={() => setOpenMenu((current) =>
                current === menuId ? null : menuId
              )}
            >
              {menuLabels[menuId]}
            </button>
            {openMenu === menuId ? (
              <div
                role="menu"
                aria-label={menuLabels[menuId]}
                className="titlebar-menu__popover"
                onKeyDown={handleMenuKeys}
              >
                {menuActions[menuId].map((action) => (
                  <button
                    key={action.label}
                    type="button"
                    role="menuitem"
                    onClick={() => runAndClose(action)}
                  >
                    {action.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ))}
      </nav>

      <div
        className="desktop-titlebar__drag-region"
        data-testid="titlebar-drag-region"
        data-tauri-drag-region
      >
        <span>{projectTitle}</span>
      </div>

      <div className="desktop-titlebar__window-actions">
        <IconButton
          label={rightCollapsed ? "展开运行栏" : "收起运行栏"}
          pressed={rightCollapsed}
          onClick={onToggleRight}
        >
          <PanelRight20Regular aria-hidden="true" />
        </IconButton>
        <span className="titlebar-separator" aria-hidden="true" />
        <IconButton label="最小化窗口" onClick={() => void windowChrome.minimize()}>
          <Subtract20Regular aria-hidden="true" />
        </IconButton>
        <IconButton
          label="最大化或还原窗口"
          onClick={() => void windowChrome.toggleMaximize()}
        >
          <Square20Regular aria-hidden="true" />
        </IconButton>
        <IconButton
          label="关闭窗口"
          className="titlebar-icon-button--close"
          onClick={() => void windowChrome.close()}
        >
          <Dismiss20Regular aria-hidden="true" />
        </IconButton>
      </div>

      {aboutOpen ? (
        <section className="about-popover" role="dialog" aria-label="关于 Blocky">
          <strong>Windows Core 技术尖峰</strong>
          <p>验证本地 Blockly 编辑、项目保存与确定性运行核心；不是正式发行版。</p>
          <button type="button" onClick={() => setAboutOpen(false)}>关闭</button>
        </section>
      ) : null}
    </header>
  );
}
