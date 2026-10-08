import type { Studio } from "../../composition/useStudio";
import { SettingsRow, SettingsGroup } from "./SettingsRow";
import { NumericPreference, PreferenceRows } from "./PreferenceRows";
export function AppearanceSettings({ studio: s }: { studio: Studio }) {
  const ui = s.settings.ui;
  return (
    <SettingsGroup title="显示与字体">
      <SettingsRow title="主题" description="立即应用到工作台和聊天">
        <select
          aria-label="应用主题"
          value={ui.values.theme}
          disabled={!ui.ready}
          onChange={(e) =>
            ui.change("theme", e.target.value as typeof ui.values.theme)
          }
        >
          <option value="dark">深色</option>
          <option value="light">浅色</option>
          <option value="system">跟随系统</option>
        </select>
      </SettingsRow>
      <SettingsRow title="界面字号" description="11–24 像素">
        <NumericPreference
          title="界面字号"
          value={ui.values.fontSize}
          min={11}
          max={24}
          disabled={!ui.ready}
          change={(n) => {
            try {
              ui.change("fontSize", n);
            } catch {
              s.setMessage("字号须为 11–24 的整数。");
            }
          }}
        />
      </SettingsRow>
      <SettingsRow title="界面字体">
        <select
          aria-label="界面字体"
          value={ui.values.fontFamily}
          disabled={!ui.ready}
          onChange={(e) =>
            ui.change(
              "fontFamily",
              e.target.value as typeof ui.values.fontFamily,
            )
          }
        >
          <option value="yahei">微软雅黑</option>
          <option value="system">系统默认</option>
          <option value="simsun">宋体</option>
        </select>
      </SettingsRow>
      <SettingsRow title="代码字体">
        <select
          aria-label="代码字体"
          value={ui.values.codeFont}
          disabled={!ui.ready}
          onChange={(e) =>
            ui.change("codeFont", e.target.value as typeof ui.values.codeFont)
          }
        >
          <option value="consolas">Consolas</option>
          <option value="courier">Courier New</option>
          <option value="system">系统等宽</option>
        </select>
      </SettingsRow>
      <PreferenceRows studio={s} ids={["ui.reduceMotion"]} />
      {ui.error && <p role="alert">{ui.error}</p>}
    </SettingsGroup>
  );
}
