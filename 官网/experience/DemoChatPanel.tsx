import { useEffect, useRef, useState } from 'react';
import { translate } from '../dist/preferences.js';
import { ChatMenuButton, ChatPopover, useChatMenu } from '../../apps/studio-desktop/src/app/ChatControls';
import { ChatComposer } from '../../apps/studio-desktop/src/app/ChatComposer';
import { ChatModelControl } from '../../apps/studio-desktop/src/app/ChatModelControl';
import { ChatHistoryMenu } from '../../apps/studio-desktop/src/app/ChatHistoryMenu';
import { ChatMarkdown } from '../../apps/studio-desktop/src/app/ChatMarkdown';
import { UiIcon } from '../../apps/studio-desktop/src/app/UiIcon';
import { useChatFollow } from '../../apps/studio-desktop/src/app/useChatFollow';
import { useDemoFollow } from './quiz-demo/useDemoFollow';
import { demoModels, type DemoMode, type DemoModelChoice } from './demoPreferences';
export type Message = { role: 'user' | 'assistant'; text: string; preset?: boolean; startedAt?: number };
type Thread = { id: string; title: string; createdAt: string; updatedAt: string; messages: Message[]; trace: string[] };
export function DemoChat({ projectKey, mode, setMode, messages, send, running, stop, sample, trace, reset, info, prompt, setPrompt, guided = false, guidedDraft = '', choice, changeChoice, restore, openSettings }: {
  projectKey: string; mode: DemoMode; setMode(mode: DemoMode): void; messages: Message[];
  send(text: string): void; running: boolean; stop(): void; sample: string; trace: string[]; reset(): void; info(): void;
  prompt: string; setPrompt(value: string): void; guided?: boolean; guidedDraft?: string;
  choice: DemoModelChoice; changeChoice(value: DemoModelChoice): void;
  restore(messages: Message[], trace: string[]): void; openSettings(): void;
}) {
  const menu = useChatMenu();
  const serial = useRef(0);
  const [active, setActive] = useState<Record<string,string>>({});
  const [saved, setSaved] = useState<Record<string,Thread[]>>({});
  const scopeKey=`${projectKey}:${mode}`;
  const activeId=active[scopeKey]??`${scopeKey}-initial`;
  const stored=saved[scopeKey]??[];
  const follow = useChatFollow(`${mode}:${activeId}`, `${messages.map(message => message.text).join('')}|${trace.join('')}`);
  useDemoFollow(follow.ref,guided,`${mode}|${messages.map(message=>message.text).join('')}|${trace.join('')}`);
  useEffect(() => { menu.set(null); }, [mode]);
  const disabled = running || guided;
  const current: Thread = {
    id: activeId, title: messages.find(message => message.role === 'user')?.text.slice(0, 32) || '新会话',
    createdAt: stored.find(thread => thread.id === activeId)?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(), messages, trace,
  };
  const remember = () => setSaved(old => ({ ...old, [scopeKey]: [...(old[scopeKey]??[]).filter(thread => thread.id !== current.id), current] }));
  const threads = [...stored.filter(thread => thread.id !== current.id), current];
  const submit = () => { if (!prompt.trim() || disabled) return; send(prompt.trim()); setPrompt(''); menu.set(null); };
  return <aside className="right-sidebar chat-sidebar" aria-label="右侧面板">
    <div className="chat-sidebar-header">
      <div className="sidebar-tabs" role="tablist" aria-label="右侧工具">{(['agent', 'builder'] as const).map(id => <button key={id} id={`sidebar-tab-${id}`} role="tab" title={id === 'agent' ? 'Blocky Agent' : '构建助手'} aria-selected={mode === id} aria-controls="chat-content" tabIndex={mode === id ? 0 : -1} disabled={disabled} onClick={() => setMode(id)} onKeyDown={event => { if (!disabled && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); const next = event.key === 'Home' ? 'agent' : event.key === 'End' ? 'builder' : id === 'agent' ? 'builder' : 'agent'; setMode(next); document.getElementById(`sidebar-tab-${next}`)?.focus(); } }}><span className="sidebar-tab-label">{id === 'agent' ? 'Blocky Agent' : '构建助手'}</span></button>)}</div>
      <div className="chat-header-actions">
        <button type="button" className="chat-icon" aria-label={mode === 'builder' ? '构建助手新会话' : 'Blocky Agent 新会话'} title="新会话" disabled={disabled} onClick={() => { remember(); setActive(old => ({ ...old, [scopeKey]: `${scopeKey}-${++serial.current}` })); reset(); menu.set(null); }}><UiIcon name="add"/></button>
        <ChatMenuButton menu={menu} kind="history" label={mode === 'builder' ? '构建助手历史会话' : 'Blocky Agent 历史会话'}><UiIcon name="history"/></ChatMenuButton>
        <button type="button" className="chat-icon" aria-label={mode === 'builder' ? '构建助手设置' : 'Blocky Agent 设置'} onClick={() => { menu.set(null); openSettings(); }}><UiIcon name="settings"/></button>
      </div>
    </div>
    <ChatHistoryMenu menu={menu} threads={threads} activeId={activeId} disabled={disabled} select={async id => { const chosen = threads.find(thread => thread.id === id); if (!chosen || disabled) return; remember(); setActive(old => ({ ...old, [scopeKey]: id })); restore(chosen.messages, chosen.trace); }}/>
    <div id="chat-content" className="sidebar-content" role="tabpanel" aria-labelledby={`sidebar-tab-${mode}`}>
      <section className={`chat-panel ${mode === 'builder' ? 'builder-panel builder-chat-panel' : 'run-panel'}`} aria-label={mode === 'builder' ? 'Blocky 构建助手' : 'Blocky Agent 聊天'}>
        <div className="builder-chat-thread" ref={follow.ref} onScroll={follow.onScroll} role="log" aria-live="polite">{guided&&trace.length>0&&<div className="demo-guided-activity"><small>{mode==='builder'?'构建进度':'运行进度'}</small>{trace.slice(-3).map((line,index)=><p key={`${trace.length}-${index}`}>✓ {line}</p>)}</div>}<ol className="builder-chat-messages">{messages.map((message, index) => <li key={index} className={`builder-chat-message builder-chat-message-${message.role}`}>{message.role === 'assistant' ? <ChatMarkdown text={translate(message.text)}/> : <p data-no-translate={message.preset ? undefined : ''}>{message.text}</p>}</li>)}</ol>
          {!messages.length && <div className="demo-chat-sample"><button onClick={() => send(translate(sample))} disabled={disabled}>{sample}<span> ↗</span></button><small>预设对话示例</small></div>}
          {!guided&&trace.length > 0 && <div className="demo-chat-activity"><details open><summary>{mode === 'builder' ? '调用轨迹 · 预设' : '运行轨迹 · 预设'}</summary>{trace.map((line, index) => <p key={index}>✓ {line}</p>)}</details></div>}
        </div>
        <ChatPopover menu={menu} kind="add" label="对话上下文"><button onClick={info}>选择工作文件夹</button><p>当前项目的积木可在此页面编辑。</p></ChatPopover>
        <ChatComposer label={mode === 'builder' ? '构建需求' : '输入问题'} placeholder={mode === 'builder' ? '描述要构建的内容' : '向 Agent 提问'} value={guided ? guidedDraft : prompt} onChange={setPrompt} onSubmit={submit} disabled={guided} maxLength={2000} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); submit(); } }}>
          <ChatMenuButton menu={menu} kind="add" label="添加上下文"><UiIcon name="add"/></ChatMenuButton>
          <ChatModelControl label={mode === 'builder' ? '构建助手模型与思考' : 'Agent 模型与思考'} modelLabel={mode === 'builder' ? '构建助手模型' : 'Agent 模型'} reasoningLabel={mode === 'builder' ? '构建助手思考等级' : 'Agent 思考等级'} models={demoModels} value={choice.model} effort={choice.effort} changeModel={model => changeChoice({ ...choice, model })} changeEffort={effort => changeChoice({ ...choice, effort })} disabled={disabled} menu={menu}/>
          <button className={`chat-send${running ? ' chat-stop' : ''}`} type={running ? 'button' : 'submit'} aria-label={running ? '停止演示' : '发送消息'} disabled={!running && (guided || !prompt.trim())} onClick={running ? () => stop() : undefined}><UiIcon name={running ? 'stop' : 'send'} className="chat-action-icon"/></button>
        </ChatComposer>
      </section>
    </div>
  </aside>;
}
