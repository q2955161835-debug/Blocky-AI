import {
  ArrowLeft20Regular,
  ArrowRight20Regular,
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
import type { SpikeBlockId } from "../blockly/catalog";
import { CommandCenter } from "./CommandCenter";
import {
  matchesShortcut,
  type CommandBlockItem,
  type WorkbenchCommand,
  type WorkbenchCommandId,
  type WorkbenchMenuId,
} from "./commands";
import type { WindowChromeBridge } from "./WindowChromeBridge";

const MENU_LABELS: Readonly<Record<WorkbenchMenuId, string>> = {
  file: "文件",
  edit: "编辑",
  view: "视图",
  help: "帮助",
};

export interface DesktopTitleBarProps {
  readonly commands: readonly WorkbenchCommand[];
  readonly blockSearchItems: readonly CommandBlockItem[];
  readonly documentLabel: string;
  readonly leftCollapsed: boolean;
  readonly rightCollapsed: boolean;
  readonly onInsertBlock: (blockType: SpikeBlockId) => void;
  readonly windowChrome: WindowChromeBridge;
}

function IconButton({
  label,
  children,
  pressed,
  disabled = false,
  onClick,
  className = "",
}: {
  readonly label: string;
  readonly children: ReactNode;
  readonly pressed?: boolean;
  readonly disabled?: boolean;
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
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function commandById(
  commands: readonly WorkbenchCommand[],
  id: WorkbenchCommandId,
): WorkbenchCommand {
  const command = commands.find((candidate) => candidate.id === id);
  if (!command) throw new Error(`WORKBENCH_COMMAND_MISSING:${id}`);
  return command;
}

function isTextEditingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement;
}

export function DesktopTitleBar({
  commands,
  blockSearchItems,
  documentLabel,
  leftCollapsed,
  rightCollapsed,
  onInsertBlock,
  windowChrome,
}: DesktopTitleBarProps) {
  const [openMenu, setOpenMenu] = useState<WorkbenchMenuId | null>(null);
  const rootRef = useRef<HTMLElement>(null);
  const undo = commandById(commands, "edit.undo");
  const redo = commandById(commands, "edit.redo");
  const toggleLeft = commandById(commands, "view.toggleLeft");
  const toggleRight = commandById(commands, "view.toggleRight");

  useEffect(() => {
    const closeOnPointerDown = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpenMenu(null);
    };
    const handleKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key === "Escape") setOpenMenu(null);
      for (const command of commands) {
        if (!command.shortcut || !command.enabled) continue;
        const isPlainLetter = command.shortcut.length === 1;
        if (isPlainLetter && isTextEditingTarget(event.target)) continue;
        if (matchesShortcut(event, command.shortcut)) {
          event.preventDefault();
          command.run();
          setOpenMenu(null);
          return;
        }
      }
    };
    document.addEventListener("pointerdown", closeOnPointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [commands]);

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

  const runAndClose = (command: WorkbenchCommand): void => {
    setOpenMenu(null);
    command.run();
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
          onClick={toggleLeft.run}
        >
          <PanelLeft20Regular aria-hidden="true" />
        </IconButton>
        <span className="titlebar-separator" aria-hidden="true" />
        <IconButton label="撤销" disabled={!undo.enabled} onClick={undo.run}>
          <ArrowLeft20Regular aria-hidden="true" />
        </IconButton>
        <IconButton label="重做" disabled={!redo.enabled} onClick={redo.run}>
          <ArrowRight20Regular aria-hidden="true" />
        </IconButton>
      </div>

      <nav className="desktop-titlebar__menus" aria-label="应用菜单">
        {(Object.keys(MENU_LABELS) as WorkbenchMenuId[]).map((menuId) => (
          <div className="titlebar-menu" key={menuId}>
            <button
              type="button"
              aria-haspopup="menu"
              aria-expanded={openMenu === menuId}
              onClick={() => setOpenMenu((current) =>
                current === menuId ? null : menuId
              )}
            >
              {MENU_LABELS[menuId]}
            </button>
            {openMenu === menuId ? (
              <div
                role="menu"
                aria-label={MENU_LABELS[menuId]}
                className="titlebar-menu__popover"
                onKeyDown={handleMenuKeys}
              >
                {commands.filter((command) => command.menu === menuId).map((command) => (
                  <button
                    key={command.id}
                    type="button"
                    role="menuitem"
                    disabled={!command.enabled}
                    aria-current={command.selected ? "true" : undefined}
                    onClick={() => runAndClose(command)}
                  >
                    <span>{command.label}</span>
                    {command.shortcut ? <kbd>{command.shortcut}</kbd> : null}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ))}
      </nav>

      <CommandCenter
        commands={commands}
        blockItems={blockSearchItems}
        onInsertBlock={onInsertBlock}
      />

      <div
        className="desktop-titlebar__drag-region"
        data-testid="titlebar-drag-region"
        data-tauri-drag-region
      >
        <span>{documentLabel}</span>
      </div>

      <div className="desktop-titlebar__window-actions">
        <IconButton
          label={rightCollapsed ? "展开右侧面板" : "收起右侧面板"}
          pressed={rightCollapsed}
          onClick={toggleRight.run}
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
    </header>
  );
}
