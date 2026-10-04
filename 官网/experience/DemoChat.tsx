import { useEffect, useRef, useState } from 'react';
import { translate } from '../dist/preferences.js';
import { ChatMenuButton, ChatPopover, useChatMenu } from '../../apps/studio-desktop/src/app/ChatControls';
export type Message = {role:'user'|'assistant';text:string};
export function DemoChat({mode,setMode,messages,send,running,stop,sample,trace,reset,info}: {
  mode:'agent'|'builder';setMode(mode:'agent'|'builder'):void;messages:Message[];
  send(text:string):void;running:boolean;stop():void;sample:string;trace:string[];reset():void;info():void;
}) {
  const [prompt,setPrompt]=useState('');
  const menu=useChatMenu();
  const thread=useRef<HTMLDivElement>(null);
  useEffect(()=>{if(thread.current)thread.current.scrollTop=thread.current.scrollHeight;},[messages,trace]);
  useEffect(()=>{setPrompt('');menu.set(null);},[mode]);
  const submit=()=>{if(!prompt.trim()||running)return;send(prompt.trim());setPrompt('');menu.set(null);};
  return <aside className="right-sidebar chat-sidebar" aria-label="右侧面板">
    <div className="sidebar-tabs" role="tablist" aria-label="右侧工具">{(['agent','builder'] as const).map((id)=><button key={id} id={`sidebar-tab-${id}`} role="tab" aria-selected={mode===id} aria-controls="chat-content" tabIndex={mode===id?0:-1} onClick={()=>setMode(id)} onKeyDown={event=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();const next=event.key==='Home'?'agent':event.key==='End'?'builder':id==='agent'?'builder':'agent';setMode(next);document.getElementById(`sidebar-tab-${next}`)?.focus();}}}>{id==='agent'?'Blocky Agent':'构建助手'}</button>)}</div>
    <div id="chat-content" className="sidebar-content" role="tabpanel" aria-labelledby={`sidebar-tab-${mode}`}>
      <section className={`chat-panel ${mode==='builder'?'builder-panel builder-chat-panel':'run-panel'}`} aria-label={mode==='builder'?'Blocky 构建助手':'Blocky Agent 聊天'}>
        <div className="chat-panel-header"><button className="chat-icon" aria-label="新对话" onClick={reset}>＋</button><ChatMenuButton menu={menu} kind="settings" label={mode==='builder'?'构建助手设置':'Blocky Agent 设置'}>⚙</ChatMenuButton></div>
        <div className="builder-chat-thread" ref={thread} role="log" aria-live="polite"><ol className="builder-chat-messages">{messages.map((message,i)=><li key={i} className={`builder-chat-message builder-chat-message-${message.role}`}><p data-no-translate={message.role === 'user' ? '' : undefined}>{message.text}</p></li>)}</ol>{!messages.length&&<div className="demo-chat-sample"><button onClick={()=>send(translate(sample))} disabled={running}>{sample}<span> ↗</span></button><small>预设对话示例</small></div>}{mode==='agent'&&trace.length>0&&<div className="trace demo-trace"><strong>运行轨迹 · 预设</strong>{trace.map((line,i)=><p key={i}>✓ {line}</p>)}</div>}</div>
        {mode==='builder'&&trace.length>0&&<div className="coding-trace"><details open><summary>调用轨迹 · 预设</summary>{trace.map((line,i)=><p key={i}>✓ {line}</p>)}</details></div>}
        <ChatPopover menu={menu} kind="add" label="对话上下文"><button onClick={info}>选择工作文件夹</button><p>当前项目的积木可在此页面编辑。</p></ChatPopover>
        <ChatPopover menu={menu} kind="settings" label="模型设置"><label>模型<select defaultValue="preset" aria-label="演示模型"><option value="preset">预设演示</option></select></label><p>对话为预设示例，不连接真实模型。</p></ChatPopover>
        <form className="builder-chat-composer chat-composer" onSubmit={event=>{event.preventDefault();submit();}}>
          <textarea aria-label={mode==='builder'?'构建需求':'输入问题'} value={prompt} onChange={event=>setPrompt(event.target.value)} placeholder={mode==='builder'?'描述要构建的内容':'输入问题'} rows={2} maxLength={2000} onKeyDown={event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.nativeEvent.isComposing){event.preventDefault();submit();}}}/>
          <div className="chat-composer-toolbar"><ChatMenuButton menu={menu} kind="add" label="添加上下文">＋</ChatMenuButton><ChatMenuButton menu={menu} kind="settings" label="选择模型" className="chat-model-chip"><span className="chat-model-name">预设演示</span><span>⌄</span></ChatMenuButton><span className="spacer"/><button className="chat-send" type={running?'button':'submit'} aria-label={running?'停止演示':'发送消息'} disabled={!running&&!prompt.trim()} onClick={running?()=>stop():undefined}>{running?'■':'↑'}</button></div>
        </form>
      </section>
    </div>
  </aside>;
}
