import { useId, useState, type ReactNode } from "react";
import { settingsSections, type SettingsSection } from "./settingsNavigation";
import "./SettingsUi.css";

export interface SettingsShellProps {
  section: SettingsSection;
  onSection(section: SettingsSection): void;
  query: string;
  onQuery(query: string): void;
  children: ReactNode;
  onClose?(): void;
}

const sectionIcons: Record<SettingsSection, string> = {
  general: "M4 5h16M4 12h16M4 19h16M8 3v4M16 10v4M10 17v4",
  appearance: "M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
  models: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z",
  builder: "M4 5h16v12H9l-5 4zM8 9h8M8 13h5",
  agent: "m9 5 10 7-10 7zM4 5v14",
  shortcuts: "M3 6h18v12H3zM6 10h1M10 10h1M14 10h1M18 10h1M7 14h10",
  advanced: "m8 5-6 7 6 7M16 5l6 7-6 7M14 3l-4 18",
};

export function SettingsShell({ section, onSection, query, onQuery, children, onClose }: SettingsShellProps) {
  const id = useId();
  const [navigationOpen, setNavigationOpen] = useState(true);
  const currentTitle = settingsSections.find((item) => item.id === section)!.title;
  return (
    <div className="settings-shell" data-navigation-open={navigationOpen}>
      <aside className="settings-sidebar" aria-label="设置导航">
        <div className="settings-sidebar-heading">
          <h2>设置</h2>
          <button className="settings-navigation-toggle" type="button" aria-expanded={navigationOpen} aria-controls={`${id}-navigation`} onClick={() => setNavigationOpen((open) => !open)}>
            {navigationOpen ? "收起分类" : "展开分类"}
          </button>
        </div>
        <div className="settings-search">
          <svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4 4" /></svg>
          <input type="search" aria-label="搜索设置" placeholder="搜索设置" value={query} onChange={(event) => onQuery(event.target.value)} />
        </div>
        <nav className="settings-navigation" id={`${id}-navigation`} aria-label="设置分类">
          {settingsSections.map((item) => (
            <button key={item.id} type="button" className="settings-navigation-item" aria-current={section === item.id ? "page" : undefined} onClick={() => onSection(item.id)}>
              <svg aria-hidden="true" viewBox="0 0 24 24"><path d={sectionIcons[item.id]} /></svg>
              <span>{item.title}</span>
            </button>
          ))}
        </nav>
      </aside>
      <section className="settings-main" aria-labelledby={`${id}-heading`}>
        <header className="settings-main-heading">
          <h2 id={`${id}-heading`}>{currentTitle}</h2>
          {onClose && <button className="settings-close" type="button" aria-label="关闭设置" onClick={onClose}><svg aria-hidden="true" viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18" /></svg></button>}
        </header>
        <div className="settings-content">{children}</div>
      </section>
    </div>
  );
}
