import { commands } from "@blocky/command-system";
import type { Studio } from "../composition/useStudio";

const icons: Record<string, string> = {
  "edit.blueprint": "M4 3h12l4 4v14H4z M8 3v6h8V3 M8 15h8v6H8z",
  "build.assistant":
    "M12 3v3 M9 3h6 M4 8h16v12H4z M8 12v2 M16 12v2 M8 17h8 M1 12v4 M23 12v4",
  "build.convert": "M8 4H3v16h5 M16 4h5v16h-5 M7 12h10 M13 8l4 4-4 4",
  "build.surface": "M3 4h18v16H3z M3 9h18 M7 6.5h1 M10 6.5h1 M9 14h6 M12 11v6",
  "file.save": "M4 3h13l3 3v15H4z M8 3v6h8V3 M8 15h8v6H8z",
  "edit.undo": "M8 5l-5 5 5 5 M3 10h10a7 7 0 0 1 7 7",
  "edit.redo": "M16 5l5 5-5 5 M21 10H11a7 7 0 0 0-7 7",
  "run.start": "M7 4l14 8-14 8z",
  "run.stop": "M5 5h14v14H5z",
  "view.toggle-left-sidebar": "M3 4h18v16H3z M9 4v16 M5 7h2 M5 10h2 M5 13h2",
  "view.toggle-bottom-panel": "M3 4h18v16H3z M3 15h18 M6 18h12",
  "view.toggle-right-sidebar":
    "M3 4h18v16H3z M15 4v16 M17 7h2 M17 10h2 M17 13h2",
  "settings.open":
    "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M10 2h4l1 4 4-1 2 4-3 3 3 3-2 4-4-1-1 4h-4l-1-4-4 1-2-4 3-3-3-3 2-4 4 1z",
  "view.command-center": "M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14 M15 15l6 6",
};
export function CommandIcon({ id }: { id: string }) {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={icons[id]} />
    </svg>
  );
}
export function ToolbarActions({
  studio: s,
  enabled,
  execute,
}: {
  studio: Studio;
  enabled(id: string): boolean;
  execute(id: string): void;
}) {
  const button = (id: string, label?: string, pressed?: boolean) => {
    const command = commands.find((command) => command.commandId === id)!;
    const name = label ?? command.label;
    const keys = s.shortcuts.keys(id).join(" / ");
    return (
      <button
        key={id}
        className={`icon-button ${id === "run.start" ? "primary" : ""}`}
        aria-label={name}
        title={`${name}${keys ? ` (${keys})` : ""}`}
        disabled={!enabled(id)}
        aria-pressed={pressed}
        onClick={() => execute(id)}
      >
        <CommandIcon id={id} />
      </button>
    );
  };
  return (
    <>
      {button("view.command-center", "搜索命令")}
      {s.started && (
        <div className="toolbar-actions" role="group" aria-label="项目操作">
          {[
            "edit.blueprint",
            "build.convert",
            "build.assistant",
            "build.surface",
            "file.save",
            "edit.undo",
            "edit.redo",
            s.running ? "run.stop" : "run.start",
          ].map((id) => button(id))}
        </div>
      )}
      <div className="layout-actions" role="group" aria-label="面板布局">
        {s.started && (
          <>
            {button(
              "view.toggle-left-sidebar",
              `${s.session.leftVisible ? "隐藏" : "显示"}左侧积木库`,
              s.session.leftVisible,
            )}
            {button(
              "view.toggle-bottom-panel",
              `${s.session.panel ? "隐藏" : "显示"}底部面板`,
              s.session.panel,
            )}
            {button(
              "view.toggle-right-sidebar",
              `${s.session.rightVisible ? "隐藏" : "显示"}右侧面板`,
              s.session.rightVisible,
            )}
          </>
        )}
        {button("settings.open", "打开设置")}
      </div>
    </>
  );
}
