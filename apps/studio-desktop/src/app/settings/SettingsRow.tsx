import { useId, type ReactNode } from "react";
import "./SettingsUi.css";

export interface SettingsRowProps {
  title: string;
  description?: string;
  children: ReactNode;
}

export function SettingsRow({ title, description, children }: SettingsRowProps) {
  const id = useId();
  return (
    <div className="settings-row" role="group" aria-labelledby={`${id}-title`} aria-describedby={description ? `${id}-description` : undefined}>
      <div className="settings-row-copy">
        <div className="settings-row-title" id={`${id}-title`}>{title}</div>
        {description && <p className="settings-row-description" id={`${id}-description`}>{description}</p>}
      </div>
      <div className="settings-row-controls">{children}</div>
    </div>
  );
}

export interface SettingsGroupProps {
  title?: string;
  children: ReactNode;
}

export function SettingsGroup({ title, children }: SettingsGroupProps) {
  const id = useId();
  return (
    <section className="settings-group" aria-labelledby={title ? id : undefined}>
      {title && <h3 className="settings-group-title" id={id}>{title}</h3>}
      <div className="settings-group-card">{children}</div>
    </section>
  );
}
