import { Search20Regular } from "@fluentui/react-icons";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import type { SpikeBlockId } from "../blockly/catalog";
import {
  searchWorkbenchItems,
  type CommandBlockItem,
  type WorkbenchCommand,
  type WorkbenchSearchItem,
} from "./commands";

export interface CommandCenterProps {
  readonly commands: readonly WorkbenchCommand[];
  readonly blockItems: readonly CommandBlockItem[];
  readonly onInsertBlock: (blockType: SpikeBlockId) => void;
}

function itemKey(item: WorkbenchSearchItem): string {
  return item.kind === "command"
    ? `command-${item.commandId}`
    : `block-${item.blockType}`;
}

function itemEnabled(item: WorkbenchSearchItem): boolean {
  return item.kind === "block" || item.enabled;
}

export function CommandCenter({
  commands,
  blockItems,
  onInsertBlock,
}: CommandCenterProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const results = useMemo(
    () => searchWorkbenchItems(query, commands, blockItems),
    [blockItems, commands, query],
  );

  useEffect(() => {
    const focusSearch = (event: globalThis.KeyboardEvent): void => {
      if (
        event.ctrlKey &&
        !event.shiftKey &&
        !event.altKey &&
        !event.metaKey &&
        event.key.toLocaleLowerCase("en-US") === "p"
      ) {
        event.preventDefault();
        setOpen(true);
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    const closeOutside = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", focusSearch);
    document.addEventListener("pointerdown", closeOutside);
    return () => {
      document.removeEventListener("keydown", focusSearch);
      document.removeEventListener("pointerdown", closeOutside);
    };
  }, []);

  useEffect(() => {
    const firstEnabled = results.findIndex(itemEnabled);
    setActiveIndex(firstEnabled >= 0 ? firstEnabled : 0);
  }, [query, results.length]);

  const execute = (item: WorkbenchSearchItem | undefined): void => {
    if (!item || !itemEnabled(item)) return;
    if (item.kind === "command") {
      commands.find((command) => command.id === item.commandId)?.run();
    } else {
      onInsertBlock(item.blockType);
    }
    setOpen(false);
    setQuery("");
    inputRef.current?.blur();
  };

  const moveActive = (direction: 1 | -1): void => {
    if (results.length === 0) return;
    let candidate = activeIndex;
    for (let attempts = 0; attempts < results.length; attempts += 1) {
      candidate = (candidate + direction + results.length) % results.length;
      if (itemEnabled(results[candidate])) {
        setActiveIndex(candidate);
        return;
      }
    }
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveActive(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      moveActive(-1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      execute(results[activeIndex]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      setQuery("");
      inputRef.current?.blur();
    }
  };

  return (
    <div ref={rootRef} className="command-center">
      <Search20Regular aria-hidden="true" />
      <input
        ref={inputRef}
        type="search"
        role="combobox"
        aria-label="搜索积木和命令"
        aria-autocomplete="list"
        aria-controls="command-center-results"
        aria-expanded={open}
        aria-activedescendant={open && results[activeIndex]
          ? `command-center-${itemKey(results[activeIndex])}`
          : undefined}
        placeholder="搜索积木和命令"
        value={query}
        onFocus={() => setOpen(true)}
        onChange={(event) => setQuery(event.currentTarget.value)}
        onKeyDown={handleKeyDown}
      />
      <kbd>Ctrl+P</kbd>
      {open ? (
        <div className="command-center__popover">
          {results.length === 0 ? (
            <p className="command-center__empty">没有匹配的积木或命令</p>
          ) : (
            <ul id="command-center-results" role="listbox" aria-label="搜索结果">
              {results.map((item, index) => (
                <li
                  id={`command-center-${itemKey(item)}`}
                  key={itemKey(item)}
                  role="option"
                  aria-selected={index === activeIndex}
                  aria-disabled={!itemEnabled(item)}
                  onPointerMove={() => {
                    if (itemEnabled(item)) setActiveIndex(index);
                  }}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => execute(item)}
                >
                  <span>{item.label}</span>
                  <small>
                    {item.kind === "command" ? item.detail : item.categoryName}
                  </small>
                  {item.kind === "command" && item.shortcut ? (
                    <kbd>{item.shortcut}</kbd>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
