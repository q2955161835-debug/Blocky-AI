import { useEffect, useRef, useState } from "react";
import type { RpaCapture } from "@blocky/rpa-core";
import { rpaNative } from "../composition/rpa";
const messages: Record<string,string> = {
  "BLK-RPA-CAPTURE-001":"截图记录无法读取或写入。", "BLK-RPA-CAPTURE-002":"截图记录无效或已删除。",
  "BLK-RPA-CAPTURE-003":"截图或保留数量超过限制，请删除不需要的记录。", "BLK-RPA-CAPTURE-004":"截图已过期。",
  "BLK-RPA-CAPTURE-005":"目标变化或无法可靠遮盖，未保存截图。", "BLK-RPA-CAPTURE-006":"目标文件已存在，请选择新文件名。",
};
export function RpaCaptures({disabled=false}:{disabled?:boolean}) {
  const [items,setItems]=useState<RpaCapture[]>([]),[view,setView]=useState<{id:string;url:string}>(),[message,setMessage]=useState(""),[busy,setBusy]=useState(false);
  const mounted=useRef(true);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  useEffect(()=>{
    if(!view)return;
    const expiry=items.find(item=>item.captureId===view.id)?.expiresAt ?? 0;
    const timer=setTimeout(()=>setView(undefined),Math.max(0,expiry-Date.now()));
    return()=>clearTimeout(timer);
  },[view,items]);
  const perform=async(action:()=>Promise<void>)=>{
    if(disabled||busy)return;setBusy(true);setMessage("");
    try{await action();}catch(error){if(mounted.current){const code=String(error).match(/BLK-RPA-[A-Z0-9-]+/)?.[0]??"BLK-RPA-CAPTURE-001";setView(undefined);setMessage(`${messages[code]??"截图操作未完成。"} ${code}`);}}
    finally{if(mounted.current)setBusy(false);}
  };
  return <section aria-label="自动化截图">
    <h3>截图记录</h3><p>输入区域已遮盖，其他可见内容仍可能包含私人信息。截图有效期为 24 小时；刷新时清理过期记录。</p>
    <button disabled={disabled||busy} onClick={()=>void perform(async()=>{const next=await rpaNative.captures();if(mounted.current){setItems(next);setView(undefined);}})}>刷新截图记录</button>
    <ul>{items.map(item=><li key={item.captureId}>
      {item.planId} / {item.stepId} · {item.width}×{item.height} · 遮盖 {item.maskedRegions} 个区域 · {new Date(item.expiresAt).toLocaleString()} 到期
      <button disabled={disabled||busy} onClick={()=>void perform(async()=>{const result=await rpaNative.captureRead(item.captureId);if(mounted.current)setView({id:item.captureId,url:result.dataUrl});})}>查看截图</button>
      <button disabled={disabled||busy} onClick={()=>void perform(async()=>{const result=await rpaNative.captureExport(item.captureId);if(mounted.current)setMessage(result.exported?"已导出截图":"已取消导出");})}>导出截图</button>
      <button disabled={disabled||busy} onClick={()=>void perform(async()=>{await rpaNative.captureDelete(item.captureId);if(mounted.current){setItems(current=>current.filter(row=>row.captureId!==item.captureId));setView(undefined);setMessage("截图已删除");}})}>删除截图</button>
    </li>)}</ul>
    {view&&<figure><img src={view.url} alt="已遮盖输入区域的自动化截图" style={{maxWidth:"100%",maxHeight:400,objectFit:"contain"}}/><button onClick={()=>setView(undefined)}>收起截图</button></figure>}
    {message&&<p role="status">{message}</p>}
  </section>;
}
