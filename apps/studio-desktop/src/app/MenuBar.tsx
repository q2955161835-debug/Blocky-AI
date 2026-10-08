import { useEffect, useEffectEvent, useRef, useState } from "react";
import { commands } from "@blocky/command-system";

const menus = [
  ["file", "文件"],
  ["edit", "编辑"],
  ["view", "视图"],
  ["run", "运行"],
  ["build", "构建"],
  ["terminal", "终端"],
  ["help", "帮助"],
] as const;
export type MenuCategory = (typeof menus)[number][0];

export function MenuBar({
  active,
  open,
  enabled,
  execute,
  disabled,
  keys,
  reason,
}: {
  active: MenuCategory | null;
  open(category: MenuCategory | null): void;
  enabled(id: string): boolean;
  execute(id: string): void;
  disabled: boolean;
  keys?(id: string): string[];
  reason?(id: string): string | undefined;
}) {
  const bar = useRef<HTMLElement>(null);
  const [tabStop, setTabStop] = useState<MenuCategory>("file");
  const closeOutside = useEffectEvent((event: PointerEvent) => {
    if (active && !bar.current?.contains(event.target as Node)) open(null);
  });
  useEffect(() => {
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, []);
  useEffect(() => {
    if (active)
      bar.current
        ?.querySelector<HTMLButtonElement>(
          '[role="menu"] button:not(:disabled)',
        )
        ?.focus();
  }, [active]);
  const focusTrigger = (category: MenuCategory) => {
    setTabStop(category);
    bar.current
      ?.querySelector<HTMLButtonElement>(`#menu-trigger-${category}`)
      ?.focus();
  };
  const switchMenu = (category: MenuCategory, direction: number) => {
    const index = menus.findIndex(([id]) => id === category);
    const next = menus[(index + direction + menus.length) % menus.length][0];
    focusTrigger(next);
    if (active) open(next);
  };
  return (
    <nav ref={bar} role="menubar" aria-label="应用菜单" className="menu-bar">
      {menus.map(([category, label]) => {
        const expanded = active === category;
        const items = commands.filter(
          (c) =>
            c.contexts.includes("studio") &&
            (c.category === category ||
            (category === "file" && c.category === "window")),
        );
        return (
          <div key={category} className="menu-anchor" role="none">
            <button
              id={`menu-trigger-${category}`}
              role="menuitem"
              aria-label={label}
              title={label}
              aria-haspopup="menu"
              aria-expanded={expanded}
              aria-controls={expanded ? `menu-${category}` : undefined}
              tabIndex={tabStop === category ? 0 : -1}
              disabled={disabled}
              onFocus={() => setTabStop(category)}
              onClick={() => open(expanded ? null : category)}
              onPointerEnter={() => {
                if (active && !expanded && !disabled) open(category);
              }}
              onKeyDown={(e) => {
                if (
                  [
                    "ArrowDown",
                    "ArrowUp",
                    "ArrowLeft",
                    "ArrowRight",
                    "Escape",
                  ].includes(e.key)
                ) {
                  e.preventDefault();
                  e.stopPropagation();
                  if (e.key === "ArrowLeft" || e.key === "ArrowRight")
                    switchMenu(category, e.key === "ArrowRight" ? 1 : -1);
                  else if (e.key === "Escape") open(null);
                  else open(category);
                }
              }}
            >
              {label}
            </button>
            {expanded && (
              <div
                id={`menu-${category}`}
                role="menu"
                aria-label={label}
                className="menu-dropdown"
                onKeyDown={(e) => {
                  const buttons = [
                    ...e.currentTarget.querySelectorAll<HTMLButtonElement>(
                      "button:not(:disabled)",
                    ),
                  ];
                  const index = buttons.indexOf(
                    document.activeElement as HTMLButtonElement,
                  );
                  if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
                    e.preventDefault();
                    e.stopPropagation();
                    const next =
                      e.key === "Home"
                        ? 0
                        : e.key === "End"
                          ? buttons.length - 1
                          : (index +
                              (e.key === "ArrowDown" ? 1 : -1) +
                              buttons.length) %
                            buttons.length;
                    buttons[next]?.focus();
                  } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                    e.preventDefault();
                    e.stopPropagation();
                    switchMenu(category, e.key === "ArrowRight" ? 1 : -1);
                  } else if (e.key === "Escape" || e.key === "Tab") {
                    if (e.key === "Escape") e.preventDefault();
                    e.stopPropagation();
                    focusTrigger(category);
                    open(null);
                  }
                }}
              >
                {items.map((command, index) => (
                  <div key={command.commandId} role="none">
                    {index > 0 &&
                      items[index - 1].category !== command.category && (
                        <div role="separator" className="menu-separator" />
                      )}
                    <button
                      role="menuitem"
                      tabIndex={-1}
                      disabled={!enabled(command.commandId)}
                      title={reason?.(command.commandId)}
                      onClick={() => {
                        focusTrigger(category);
                        execute(command.commandId);
                      }}
                    >
                      <span>{command.label}</span>
                      <kbd>
                        {
                          (keys?.(command.commandId) ??
                            command.defaultShortcuts)[0]
                        }
                      </kbd>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}
