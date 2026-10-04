import { report } from './scenario';
export function Delivery({open,close}:{open:boolean;close():void}) {
  return <div className="guided-delivery">
    <header><div><span>◇</span><strong>周报.md</strong><small>示例产物</small></div><button onClick={close} aria-label="关闭周报预览">×</button></header>
    {open&&<div className="guided-report" role="region" aria-label="周报预览"><pre>{report}</pre></div>}
  </div>;
}
