import { useState } from "react";
import { BROWSER_RPA_VIEWPORT, type RpaStep } from "@blocky/rpa-core";
import type { RpaTarget } from "../composition/rpa";

export function RpaCoordinateFallback({ kind, target, disabled, add }: { kind: "windows" | "browser"; target?: RpaTarget; disabled: boolean; add(step: RpaStep): void }) {
  const [x, setX] = useState(""), [y, setY] = useState(""), [accepted, setAccepted] = useState(false);
  const minimum = kind === "windows" ? -32768 : 0;
  const maxX = kind === "windows" ? 32767 : BROWSER_RPA_VIEWPORT.width - 1, maxY = kind === "windows" ? 32767 : BROWSER_RPA_VIEWPORT.height - 1;
  const valid = /^-?\d+$/.test(x) && /^-?\d+$/.test(y) && Number(x) >= minimum && Number(y) >= minimum && Number(x) <= maxX && Number(y) <= maxY;
  const client = target?.coordinateFrame?.client;
  const append = () => {
    if (disabled || !valid || !accepted) return;
    add({ stepId: `step-${crypto.randomUUID()}`, action: "click", locator: { kind: "coordinate", x: Number(x), y: Number(y), riskAccepted: true }, timeoutMs: 5000, effectKey: `effect-${crypto.randomUUID()}` });
    setAccepted(false);
  };
  return <details><summary>坐标回退（高风险）</summary>
    <p>仅在语义定位不可用时使用。布局变化可能误点。{kind === "windows" ? "使用屏幕物理像素；主屏左方或上方显示器的坐标可为负。批准后会聚焦目标窗口并移动系统鼠标，请先松开按键并核对目标客户区。" : "坐标从隔离浏览器可见页面左上角开始，单位为 CSS 像素。"}</p>
    {kind === "windows" && client && <p>当前客户区：X [{client.left}, {client.right})，Y [{client.top}, {client.bottom})；DPI {target?.coordinateFrame?.dpi}。移动窗口后请刷新目标。</p>}
    {kind === "windows" && target?.coordinateError && <p>暂无法读取客户区，请还原目标窗口后刷新。</p>}
    <label>坐标 X<input type="number" min={minimum} max={maxX} step={1} value={x} onChange={event => { setX(event.target.value); setAccepted(false); }} /></label>
    <label>坐标 Y<input type="number" min={minimum} max={maxY} step={1} value={y} onChange={event => { setY(event.target.value); setAccepted(false); }} /></label>
    <label><input type="checkbox" checked={accepted} onChange={event => setAccepted(event.target.checked)} />我已核对坐标并接受误点风险</label>
    <button disabled={disabled || !valid || !accepted} onClick={append}>添加坐标点击</button>
  </details>;
}
