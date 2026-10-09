import { useEffect, useRef, useState } from 'react';
import { SettingsShell } from '../../apps/studio-desktop/src/app/settings/SettingsShell';
import { SettingsGroup, SettingsRow } from '../../apps/studio-desktop/src/app/settings/SettingsRow';
import { settingsSections, type SettingsSection } from '../../apps/studio-desktop/src/app/settings/settingsNavigation';
import { ModelPicker } from '../../apps/studio-desktop/src/app/ModelPicker';
import { ReasoningPicker } from '../../apps/studio-desktop/src/app/ReasoningPicker';
import { Preferences } from './Preferences';
import { translate } from '../dist/preferences.js';
import { demoModels, type DemoAppearance, type DemoMode, type DemoModelChoices, type DemoModelChoice } from './demoPreferences';
export function DemoSettings({ section, onSection, close, choices, changeChoice, appearance, changeAppearance }: {
  section: SettingsSection | null; onSection(value: SettingsSection): void; close(): void;
  choices: DemoModelChoices; changeChoice(mode: DemoMode, value: DemoModelChoice): void;
  appearance: DemoAppearance; changeAppearance(value: DemoAppearance): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState('');
  const open = section !== null;
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    return () => { dialog.current?.close(); previous?.focus(); };
  }, [open]);
  const modelRows = (mode: DemoMode) => <SettingsGroup title={mode === 'builder' ? '构建助手' : 'Blocky Agent'}>
    <SettingsRow title="模型"><ModelPicker label={mode === 'builder' ? '构建助手模型' : 'Agent 模型'} value={choices[mode].model} models={demoModels} disabled={false} change={model => changeChoice(mode, { ...choices[mode], model })}/></SettingsRow>
    <SettingsRow title="思考等级"><ReasoningPicker label={mode === 'builder' ? '构建助手思考等级' : 'Agent 思考等级'} value={choices[mode].effort} model={demoModels.find(model => model.resourceId === choices[mode].model)} disabled={false} change={effort => changeChoice(mode, { ...choices[mode], effort })}/></SettingsRow>
  </SettingsGroup>;
  if (!section) return null;
  const matching = settingsSections.filter(item => `${item.title} ${translate(item.title, 'en')}`.toLowerCase().includes(query.trim().toLowerCase()));
  return <dialog ref={dialog} className="demo-settings-dialog" aria-label="设置" onCancel={close}>
    <SettingsShell section={section} onSection={onSection} query={query} onQuery={setQuery} onClose={close}>
      <p className="muted demo-settings-note">在线体验使用预设内容，模型选择仅用于界面预览。</p>
      {query.trim() ? <div className="settings-search-results">{matching.map(item => <button key={item.id} onClick={() => { onSection(item.id); setQuery(''); }}>{item.title}</button>)}{!matching.length && <p>没有匹配的设置</p>}</div> : <>
        {section === 'general' && <SettingsGroup title="项目"><SettingsRow title="自动保存" description="桌面作品自动保存；在线样例仅保留于本次体验。"><input type="checkbox" role="switch" aria-label="自动保存" checked disabled/></SettingsRow><SettingsRow title="项目格式"><span>.blocky</span></SettingsRow></SettingsGroup>}
        {section === 'permissions' && <SettingsGroup title="权限"><SettingsRow title="默认权限" description="桌面版可选择完整权限或执行前询问。"><select aria-label="默认权限" value="full" disabled><option value="full">完整权限</option></select></SettingsRow><SettingsRow title="工作文件夹" description="在桌面版中选择工作目录。"><span>未选择</span></SettingsRow></SettingsGroup>}
        {section === 'appearance' && <SettingsGroup title="界面"><SettingsRow title="语言与主题"><Preferences/></SettingsRow><SettingsRow title="界面字号"><select aria-label="界面字号" value={appearance.fontSize} onChange={event => changeAppearance({ ...appearance, fontSize: Number(event.target.value) })}>{[12,13,14,16].map(size => <option key={size} value={size}>{size}px</option>)}</select></SettingsRow><SettingsRow title="界面字体"><select aria-label="界面字体" value={appearance.font} onChange={event => changeAppearance({ ...appearance, font: event.target.value })}><option value={'"Microsoft YaHei UI", "Segoe UI", sans-serif'}>系统默认</option><option value="Arial, sans-serif">Arial</option></select></SettingsRow><SettingsRow title="代码字体"><select aria-label="代码字体" value={appearance.codeFont} onChange={event => changeAppearance({ ...appearance, codeFont: event.target.value })}><option value="ui-monospace, Consolas, monospace">系统默认</option><option value="Consolas, monospace">Consolas</option></select></SettingsRow></SettingsGroup>}
        {section === 'models' && <>{modelRows('agent')}{modelRows('builder')}</>}
        {(section === 'builder' || section === 'agent') && modelRows(section === 'builder' ? 'builder' : 'agent')}
        {section === 'shortcuts' && <SettingsGroup title="画布与对话"><SettingsRow title="撤销 / 重做"><span><kbd>Ctrl+Z</kbd> / <kbd>Ctrl+Shift+Z</kbd></span></SettingsRow><SettingsRow title="发送 / 换行"><span><kbd>Enter</kbd> / <kbd>Shift+Enter</kbd></span></SettingsRow><SettingsRow title="搜索积木"><kbd>Tab</kbd></SettingsRow></SettingsGroup>}
        {section === 'advanced' && <SettingsGroup title="专业"><SettingsRow title="终端与日志" description="在桌面版中配置输出、日志保留和容量。"><span>桌面版</span></SettingsRow></SettingsGroup>}
      </>}
    </SettingsShell>
  </dialog>;
}
