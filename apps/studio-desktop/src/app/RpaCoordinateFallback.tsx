import { useState } from "react";
import { BROWSER_RPA_VIEWPORT, type RpaStep } from "@blocky/rpa-core";

export function RpaCoordinateFallback({ disabled, add }: { disabled: boolean; add(step: RpaStep): void }) {
  const [x, setX] = useState(""), [y, setY] = useState(""), [accepted, setAccepted] = useState(false);
  const valid = /^\d+$/.test(x) && /^\d+$/.test(y) && Number(x) < BROWSER_RPA_VIEWPORT.width && Number(y) < BROWSER_RPA_VIEWPORT.height;
  const append = () => {
    if (disabled || !valid || !accepted) return;
    add({ stepId: `step-${crypto.randomUUID()}`, action: "click", locator: { kind: "coordinate", x: Number(x), y: Number(y), riskAccepted: true }, timeoutMs: 5000, effectKey: `effect-${crypto.randomUUID()}` });
    setAccepted(false);
  };
  return <details><summary>坐标回退（高风险）</summary>
    <p>仅在语义定位不可用时使用。页面布局变化可能误点。坐标从隔离浏览器可见页面左上角开始，单位为 CSS 像素。</p>
    <label>坐标 X<input type="number" min={0} max={BROWSER_RPA_VIEWPORT.width - 1} step={1} value={x} onChange={event => { setX(event.target.value); setAccepted(false); }} /></label>
    <label>坐标 Y<input type="number" min={0} max={BROWSER_RPA_VIEWPORT.height - 1} step={1} value={y} onChange={event => { setY(event.target.value); setAccepted(false); }} /></label>
    <label><input type="checkbox" checked={accepted} onChange={event => setAccepted(event.target.checked)} />我已核对坐标并接受误点风险</label>
    <button disabled={disabled || !valid || !accepted} onClick={append}>添加坐标点击</button>
  </details>;
}
