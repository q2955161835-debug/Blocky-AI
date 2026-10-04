import { useEffect, useRef, useState } from 'react';
import { catalog } from './data';
export function DemoDialog({kind,close,add}: {kind:'search'|'info'|null;close():void;add(type:string):void}) {
  const dialog=useRef<HTMLDialogElement>(null);
  const [query,setQuery]=useState('');
  useEffect(()=>{
    if(!kind)return;
    const previous=document.activeElement as HTMLElement|null;
    dialog.current?.showModal();
    return ()=>{dialog.current?.close();previous?.focus();};
  },[kind]);
  if(!kind)return null;
  return <dialog ref={dialog} className="demo-dialog" onCancel={close} onClose={close}>
    <header><h2>{kind==='search'?'搜索积木':'在线体验'}</h2><button aria-label="关闭" onClick={close}>×</button></header>
    {kind==='search'?<><input aria-label="查找积木" placeholder="输入积木名称" value={query} onChange={e=>setQuery(e.target.value)} autoFocus/><div className="demo-search-results">{catalog.filter(b=>b.label.includes(query)||b.type.includes(query)).map(b=><button key={b.type} onClick={()=>{add(b.type);close();}}><span style={{color:b.color}}>●</span> {b.label}</button>)}</div></>:<><p>这里使用 Blocky 的真实积木画布与蓝图，展示创作界面。</p><p>对话和运行结果为预设示例。文件、模型和部署功能可在桌面版中配置，此页面不连接这些服务。</p><p>点击积木字段可编辑，拖动可调整位置。通过工具栏撤销、切换面板，或从开始页选择另一种蓝图。</p><button className="primary" onClick={close}>继续体验</button></>}
  </dialog>;
}
