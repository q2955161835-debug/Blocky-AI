import { useEffect, useRef, useState } from 'react';
import { Canvas, type CanvasHandle } from '../../packages/ui-editor/src/canvas/Canvas';
import { MenuBar, type MenuCategory } from '../../apps/studio-desktop/src/app/MenuBar';
import { CommandIcon } from '../../apps/studio-desktop/src/app/ToolbarActions';
import { ResizeHandle } from '../../apps/studio-desktop/src/app/ResizeHandle';
import type { Workspace } from '../../packages/language-schema/src/index';
import type { RuntimeEvent } from '../../packages/observability/src/events';
import { DemoLibrary } from './DemoLibrary';
import { DemoChat, type Message } from './DemoChat';
import { DemoDialog } from './DemoDialog';
import { Preferences } from './Preferences';
import { GuidedControls } from './guided-demo/GuidedControls';
import { Delivery } from './guided-demo/Delivery';
import { useGuidedDemo } from './guided-demo/useGuidedDemo';
import { buildPrompt,taskPrompt,buildStage,type DemoAction } from './guided-demo/scenario';
import { subscribePreferences, translate, localizeDefault } from '../dist/preferences.js';
import { catalog, startingBlueprints, createWorkspace, localizeWorkspace, descriptions, examples, flatten, removeBlock, type BlueprintId } from './data';

type Mode='agent'|'builder';
const projectActions=[['edit.blueprint','保存为蓝图'],['build.convert','项目积木化'],['build.assistant','构建助手'],['build.surface','创建应用界面'],['file.save','保存项目'],['edit.undo','撤销'],['edit.redo','重做']] as const;
const nativeOnly=new Set(['file.open','file.save','file.save-as','file.migrate','edit.blueprint','build.convert','build.surface','settings.open','settings.resources','help.about','help.shortcuts','terminal.create','terminal.run-task']);
export function DemoApp() {
  const [started,setStarted]=useState(false),[blueprint,setBlueprint]=useState<BlueprintId|'blank'>('knowledge-assistant');
  const [history,setHistory]=useState<{past:Workspace[];current:Workspace;future:Workspace[]}>(()=>({past:[],current:createWorkspace('knowledge-assistant'),future:[]}));
  const [generation,setGeneration]=useState(0),[selected,setSelected]=useState<string|null>(null);
  const [view,setView]=useState<'beginner'|'professional'>('professional');
  const [mode,setMode]=useState<Mode>('builder'),[mobilePanel,setMobilePanel]=useState('canvas');
  const [leftVisible,setLeftVisible]=useState(true),[rightVisible,setRightVisible]=useState(true),[bottom,setBottom]=useState(false);
  const [leftWidth,setLeftWidth]=useState(250),[rightWidth,setRightWidth]=useState(360);
  const [menu,setMenu]=useState<MenuCategory|null>(null),[dialog,setDialog]=useState<'search'|'info'|null>(null);
  const [messages,setMessages]=useState<Record<Mode,Message[]>>({agent:[],builder:[]});
  const [draft,setDraft]=useState('');
  const [trace,setTrace]=useState<string[]>([]),[events,setEvents]=useState<RuntimeEvent[]>([]),[running,setRunning]=useState(false);
  const [status,setStatus]=useState('UI 演示 · 预设内容'),[bottomTab,setBottomTab]=useState('problems');
  const [canvasName,setCanvasName]=useState(()=>translate('主画布')),[canvasOpen,setCanvasOpen]=useState(true);
  const [focusId,setFocusId]=useState<string|undefined>(),[reportShown,setReportShown]=useState(false),[hasReport,setHasReport]=useState(false);
  const guidedPrevious=useRef<{started:boolean;blueprint:typeof blueprint;history:typeof history;mode:Mode;messages:typeof messages;canvasName:string;canvasOpen:boolean;mobilePanel:string;draft:string;trace:string[];leftVisible:boolean;rightVisible:boolean;bottom:boolean;bottomTab:string;hasReport:boolean;reportShown:boolean}|null>(null);
  const api=useRef<CanvasHandle|null>(null),timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  const pendingAdd=useRef<string|null>(null);
  const groupRef=useRef<string|undefined>(undefined);
  const guided=useGuidedDemo(applyGuidedAction);
  const workspace=history.current;
  const title=blueprint==='blank'?'未命名项目':startingBlueprints.find(b=>b.id===blueprint)!.displayName;
  const example=examples[blueprint==='blank'?'knowledge-assistant':blueprint];
  useEffect(()=>()=>clearTimeout(timer.current),[]);
  useEffect(()=>subscribePreferences(()=>{
    setHistory(old=>({past:old.past.map(localizeWorkspace),current:localizeWorkspace(old.current),future:old.future.map(localizeWorkspace)}));
    setCanvasName(name=>['主画布','Main canvas'].includes(name)?localizeDefault(name):name);
  }),[]);
  useEffect(()=>{if(started&&canvasOpen&&pendingAdd.current&&api.current){api.current.add(pendingAdd.current);pendingAdd.current=null;}},[started,canvasOpen]);
  function endGuided(restore=true) {
    guided.stop();setRunning(false);setEvents([]);setFocusId(undefined);
    const previous=guidedPrevious.current;guidedPrevious.current=null;
    if(restore&&previous){
      setStarted(previous.started);setBlueprint(previous.blueprint);setHistory({past:previous.history.past.map(localizeWorkspace),current:localizeWorkspace(previous.history.current),future:previous.history.future.map(localizeWorkspace)});setMode(previous.mode);setMessages(previous.messages);setCanvasName(['主画布','Main canvas'].includes(previous.canvasName)?localizeDefault(previous.canvasName):previous.canvasName);setCanvasOpen(previous.canvasOpen);setMobilePanel(previous.mobilePanel);setDraft(previous.draft);setHasReport(previous.hasReport);setReportShown(previous.reportShown);setTrace(previous.trace);setLeftVisible(previous.leftVisible);setRightVisible(previous.rightVisible);setBottom(previous.bottom);setBottomTab(previous.bottomTab);
    }
    setStatus('UI 演示 · 预设内容');
  }
  function stop(message='演示已停止') {clearTimeout(timer.current);if(guided.active)endGuided();setRunning(false);setEvents([]);setStatus(message);}
  function beginGuided() {
    clearTimeout(timer.current);
    if(!guided.active)guidedPrevious.current={started,blueprint,history,mode,messages,canvasName,canvasOpen,mobilePanel,draft,trace,leftVisible,rightVisible,bottom,bottomTab,hasReport,reportShown};
    setStarted(true);setBlueprint('work-assistant');setHistory({past:[],current:createWorkspace('blank'),future:[]});groupRef.current=undefined;
    setGeneration(value=>value+1);setMode('builder');setDraft('');setMessages({builder:[],agent:[]});setTrace([]);setEvents([]);setSelected(null);setCanvasOpen(true);setCanvasName(translate('主画布'));setLeftVisible(true);setRightVisible(true);setBottom(false);setMenu(null);setDialog(null);setMobilePanel('chat');setRunning(false);setFocusId(undefined);setHasReport(false);setReportShown(false);setStatus('完整演示 · 正在构建工作助手');
    guided.start();
  }
  function applyGuidedAction(action:DemoAction) {
    if(action.kind==='message'){
      setMode(action.mode);setMobilePanel('chat');setMessages(old=>({...old,[action.mode]:[...old[action.mode],{role:action.role,text:action.text,preset:true}]}));
      if(action.role==='user')setRunning(true);
    }else if(action.kind==='workspace'){
      edit(buildStage(action.stage),'guided-build');setFocusId(action.focus);setMobilePanel('canvas');
      if(action.stage===4){api.current?.zoom(-1);api.current?.zoom(-1);}
    }else if(action.kind==='trace'){
      setTrace(old=>[...old,action.text]);
      if(action.blockId){setFocusId(action.blockId);setEvents([{eventVersion:'blocky.event/v1alpha1',projectId:'website-demo',moduleId:'main',runId:'guided-work',sequence:Math.round(performance.now()),timestamp:new Date().toISOString(),type:'block.started',blockId:action.blockId,data:{},redaction:{applied:true,categories:[]}}]);}
    }else if(action.kind==='mode'){
      setMode('agent');setTrace([]);setMobilePanel('chat');setRunning(false);setEvents([]);setStatus('完整演示 · Agent 正在完成工作');
    }else{
      setRunning(false);setEvents([]);setHasReport(true);setReportShown(true);setMobilePanel('canvas');setStatus('完整演示完成 · 周报示例已生成');
    }
  }
  function edit(next:Workspace,group?:string) {
    const sameGroup=!!group&&groupRef.current===group;
    setHistory(old=>({past:sameGroup?old.past:[...old.past,old.current].slice(-50),current:next,future:[]}));
    groupRef.current=group;
  }
  function start(id:BlueprintId|'blank') {
    stop('UI 演示 · 预设内容');setBlueprint(id);setHistory({past:[],current:createWorkspace(id),future:[]});
    setGeneration(v=>v+1);setSelected(null);setDraft('');setTrace([]);setMessages({agent:[],builder:[]});setStarted(true);setCanvasOpen(true);setCanvasName(translate('主画布'));setMobilePanel('canvas');setMenu(null);setHasReport(false);setReportShown(false);setFocusId(undefined);groupRef.current=undefined;
  }
  function add(type:string){if(flatten(workspace).length>=100){setStatus('演示画布最多保留 100 块积木');return;}stop('已加入积木');if(!started||!canvasOpen){pendingAdd.current=type;setStarted(true);setCanvasOpen(true);}else api.current?.add(type);setMobilePanel('canvas');}
  function send(text:string) {
    if(running||guided.active)return;
    const activeMode=mode;
    setMessages(old=>({...old,[activeMode]:[...old[activeMode],{role:'user',text}]}));
    setRunning(true);setTrace([]);setStatus('预设演示中…');
    const blocks=flatten(workspace).slice(0,8);let index=0;
    const tick=()=>{
      if(index<blocks.length){
        const block=blocks[index++];
        const label=catalog.find(b=>b.type===block.type)?.label??block.type;
        setTrace(old=>[...old,label]);
        setEvents([{eventVersion:'blocky.event/v1alpha1',projectId:'website-demo',moduleId:'main',runId:'demo-run',sequence:index,timestamp:new Date().toISOString(),type:'block.started',blockId:block.id,data:{},redaction:{applied:true,categories:[]}}]);
        timer.current=setTimeout(tick,450);
      }else{
        setMessages(old=>({...old,[activeMode]:[...old[activeMode],{role:'assistant',text:activeMode==='builder'?'预设修改示例：已在画布中加入“补充指令”积木。点击其中的内容字段即可继续编辑，也可通过工具栏撤销。':`预设回答示例：${example[1]}`}]}));
        if(activeMode==='builder')api.current?.add('core.prompt.context');
        setRunning(false);setEvents([]);setStatus('演示完成 · 未调用模型或工具');
      }
    };
    timer.current=setTimeout(tick,350);
  }
  function switchMode(next:Mode){stop('UI 演示 · 预设内容');setMode(next);setDraft('');setTrace([]);}
  const enabled=(id:string)=>{
    if(guided.active)return id==='run.stop'||id==='window.exit';
    if(id==='edit.undo')return history.past.length>0&&!running;
    if(id==='edit.redo')return history.future.length>0&&!running;
    if(id==='run.stop')return running;
    if(id==='run.start')return started&&!running&&flatten(workspace).length>0;
    if(['edit.delete','edit.collapse','edit.expand'].includes(id))return !!selected&&!running;
    return nativeOnly.has(id)||['file.new','window.exit','view.command-center'].includes(id)||(started&&['view.toggle-left-sidebar','view.toggle-right-sidebar','view.toggle-bottom-panel','view.show-problems','view.show-run-log','build.assistant','edit.select-all','edit.clear-selection'].includes(id));
  };
  function execute(id:string){
    setMenu(null);
    if(id==='file.new'){start('blank');return;}
    if(id==='window.exit'){window.top!.location.hash='';return;}
    if(id==='view.command-center'){setDialog('search');return;}
    if(nativeOnly.has(id)){setDialog('info');return;}
    if(id==='edit.undo'){setHistory(old=>old.past.length?{past:old.past.slice(0,-1),current:old.past.at(-1)!,future:[old.current,...old.future]}:old);return;}
    if(id==='edit.redo'){setHistory(old=>old.future.length?{past:[...old.past,old.current],current:old.future[0],future:old.future.slice(1)}:old);return;}
    if(id==='run.start'){send(translate(example[0]));return;}
    if(id==='run.stop'){stop();return;}
    if(id==='view.toggle-left-sidebar'){setLeftVisible(v=>!v);return;}
    if(id==='view.toggle-right-sidebar'){setRightVisible(v=>!v);return;}
    if(id==='view.toggle-bottom-panel'){setBottom(v=>!v);return;}
    if(id==='build.assistant'){switchMode('builder');setRightVisible(true);setMobilePanel('chat');return;}
    if(id==='view.show-problems'||id==='view.show-run-log'){setBottom(true);setBottomTab(id==='view.show-problems'?'problems':'logs');return;}
    if(id==='edit.select-all'){api.current?.selectAll();return;}
    if(id==='edit.clear-selection'){api.current?.clearSelection();return;}
    if(id==='edit.collapse'||id==='edit.expand'){api.current?.collapse(id==='edit.collapse');return;}
    if(id==='edit.delete'&&selected){edit(removeBlock(workspace,selected));setSelected(null);}
  }
  const icon=(id:string,label:string,pressed?:boolean)=><button key={id} className={`icon-button ${id==='run.start'?'primary':''}`} aria-label={label} title={label} aria-pressed={pressed} disabled={!enabled(id)} onClick={()=>execute(id)}><CommandIcon id={id}/></button>;
  const draftWindow=guided.elapsed<6?{start:0,end:6,text:buildPrompt}:guided.elapsed>=36&&guided.elapsed<40?{start:36,end:40,text:taskPrompt}:null;
  const guidedDraft=draftWindow?translate(draftWindow.text).slice(0,Math.floor(translate(draftWindow.text).length*(guided.elapsed-draftWindow.start)/(draftWindow.end-draftWindow.start))):'';
  return <>
    <div className="demo-banner"><span>在线体验 <span className="demo-banner-detail">· 预设内容</span></span>{!guided.active&&<button className="guided-banner-entry" onClick={beginGuided}>▶ 1 分钟完整演示</button>}<button onClick={()=>setDialog('info')}>体验说明</button><a href="../#" target="_top">返回官网 ↗</a><Preferences/></div>
    <main className="studio demo-studio" onKeyDown={event=>{
      const target=event.target as HTMLElement;
      if(guided.active)return;
      if(target.matches('input,textarea,select')||target.isContentEditable)return;
      const command=(event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='z'?(event.shiftKey?'edit.redo':'edit.undo'):event.key==='Delete'?'edit.delete':null;
      if(command&&enabled(command)){event.preventDefault();execute(command);}
    }}>
      <header className="topbar"><button className="brand" aria-label="返回开始页" onClick={()=>{stop();setStarted(false);}}><span className="brand-mark">B</span><strong>Blocky</strong></button>
        <MenuBar active={menu} open={setMenu} enabled={enabled} execute={execute} disabled={false}/>
        {started&&<div className="project-title"><strong>{title}</strong>{history.past.length>0&&<span className="dirty" title="未保存">●</span>}</div>}
        <span className="spacer"/>{icon('view.command-center','搜索命令')}
        {started&&<div className="toolbar-actions" role="group" aria-label="项目操作">{projectActions.map(([id,label])=>icon(id,label))}{icon(running?'run.stop':'run.start',running?'停止演示':'运行演示')}</div>}
        <div className="layout-actions">{started&&<>{icon('view.toggle-left-sidebar',`${leftVisible?'隐藏':'显示'}左侧积木库`,leftVisible)}{icon('view.toggle-bottom-panel',`${bottom?'隐藏':'显示'}底部面板`,bottom)}{icon('view.toggle-right-sidebar',`${rightVisible?'隐藏':'显示'}右侧面板`,rightVisible)}</>}{icon('settings.open','打开设置')}</div>
      </header>
      {guided.active&&<GuidedControls elapsed={guided.elapsed} status={guided.status as 'playing'|'paused'|'complete'} pause={guided.pause} resume={guided.resume} replay={beginGuided} close={()=>endGuided()} continueEditing={()=>endGuided(false)}/>}
      {!started?<section className="welcome"><div className="welcome-heading"><span className="eyebrow">把想法搭起来</span><h1>从一个问题，<br/>开始创作。</h1><p>用积木组合角色、资料和工具，构建你的 AI 项目。</p><div className="welcome-actions"><button className="primary" onClick={()=>start('blank')}>新建空白项目</button><button onClick={()=>setDialog('info')}>打开本机项目</button></div><button className="guided-entry" onClick={beginGuided}><span aria-hidden="true">▶</span><div><strong>工作助手 · 1 分钟演示</strong><small>从一句需求，到 Agent 完成工作</small></div></button></div><section className="demo-blueprints" aria-label="内置起始蓝图"><h2>选择一个起点</h2><div>{startingBlueprints.map(b=><button key={b.id} aria-label={`从${b.displayName}开始`} onClick={()=>start(b.id)}><strong>{b.displayName}</strong><span>{descriptions[b.id]}</span></button>)}</div></section></section>:<>
        <nav className="demo-mobile-tabs" aria-label="工作区面板">{[['library','积木库'],['canvas','画布'],['chat','对话']].map(([id,label])=><button key={id} aria-pressed={mobilePanel===id} onClick={()=>{setMobilePanel(id);if(id==='library')setLeftVisible(true);if(id==='chat')setRightVisible(true);}}>{label}</button>)}</nav>
        <div className="workbench demo-workbench" data-panel={mobilePanel} style={{gridTemplateColumns:`${leftVisible?`minmax(180px,${leftWidth}px)`:'0px'} ${leftVisible?'4px':'0px'} minmax(0,1fr) ${rightVisible?'4px':'0px'} ${rightVisible?`minmax(240px,${rightWidth}px)`:'0px'}`}}>
          <div className="workbench-left" hidden={!leftVisible} inert={guided.active}><DemoLibrary view={view} setView={setView} add={add} start={start} search={()=>setDialog('search')}/></div>
          {leftVisible?<ResizeHandle className="left-boundary" label="左侧积木库宽度" axis="x" min={180} max={400} value={leftWidth} onChange={setLeftWidth}/>:<div className="left-boundary"/>}
          <section className="workspace"><div className="workspace-tabs"><div className="active"><button data-no-translate="" onClick={()=>{setCanvasOpen(true);setReportShown(false);}}>▧ {canvasName}</button><button aria-label="关闭主画布" disabled={guided.active} onClick={()=>setCanvasOpen(false)}>×</button></div>{hasReport&&<div className={reportShown?'active':undefined}><button onClick={()=>setReportShown(true)}>周报.md</button></div>}</div>
            {canvasOpen?<><div className="canvas-toolbar"><button aria-label="重置当前蓝图" title="重置当前蓝图" disabled={guided.active} onClick={()=>start(blueprint)}>↺</button><input aria-label="画布名称" disabled={guided.active} value={canvasName} onChange={e=>setCanvasName(e.target.value)}/><span className="spacer"/>{selected&&<button aria-label="删除选中积木" onClick={()=>execute('edit.delete')}>×</button>}<button aria-label="缩小画布" onClick={()=>api.current?.zoom(-1)}>−</button><button aria-label="放大画布" onClick={()=>api.current?.zoom(1)}>＋</button></div>
            <div className="guided-canvas" inert={guided.active}><Canvas key={generation} workspace={workspace} moduleId="main" onChange={edit} onSelect={setSelected} onSearch={()=>setDialog('search')} onContext={()=>setMenu('edit')} handle={value=>{api.current=value;}} events={events} reduceMotion={true} focusId={focusId} onViewport={()=>{}}/></div></>:<div className="demo-empty"><button onClick={()=>setCanvasOpen(true)}>重新打开主画布</button></div>}
            {hasReport&&reportShown&&<Delivery open={reportShown} close={()=>setReportShown(false)}/>}
            {bottom&&<section className="demo-bottom"><div role="tablist" aria-label="底部面板">{[['problems','问题'],['logs','运行日志'],['terminal','终端'],['output','输出']].map(([id,label])=><button key={id} role="tab" aria-selected={bottomTab===id} onClick={()=>setBottomTab(id)}>{label}</button>)}<button aria-label="关闭底部面板" onClick={()=>setBottom(false)}>×</button></div><div role="tabpanel">{bottomTab==='logs'?trace.map((line,i)=><p key={i}>✓ {line}</p>):bottomTab==='terminal'?<p>终端在桌面版中使用。</p>:bottomTab==='output'?<p>预设 UI 演示，无真实工具输出。</p>:<p>此页面仅展示 UI；运行检查在桌面版中进行。</p>}</div></section>}
          </section>
          {rightVisible?<ResizeHandle className="right-boundary" label="右侧面板宽度" axis="x" reverse min={240} max={500} value={rightWidth} onChange={setRightWidth}/>:<div className="right-boundary"/>}
          <div className="workbench-right" hidden={!rightVisible}><DemoChat prompt={draft} setPrompt={setDraft} guided={guided.active} guidedDraft={guidedDraft} mode={mode} setMode={switchMode} messages={messages[mode]} send={send} running={running} stop={stop} trace={trace} sample={mode==='builder'?'帮我加入补充指令':example[0]} reset={()=>{stop();setDraft('');setMessages(old=>({...old,[mode]:[]}));setTrace([]);}} info={()=>setDialog('info')}/></div>
        </div>
      </>}
      <footer className="statusbar"><span role="status">{status}</span><span className="spacer"/><span>Blocky Studio</span></footer>
    </main>
    <DemoDialog kind={dialog} close={()=>setDialog(null)} add={add}/>
  </>;
}
