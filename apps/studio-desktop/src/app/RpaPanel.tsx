import { useEffect, useRef, useState } from "react";
import { rpaPlanSchema, rpaBrowserStartSchema, type RpaPlan, type RpaAction, type RpaStep } from "@blocky/rpa-core";
import { rpaNative, type RpaTarget, type RpaStatus, type RpaRecoveryRun } from "../composition/rpa";
import { RpaCheckpoints } from "./RpaCheckpoints";
import { RpaRecorder } from "./RpaRecorder";
import { RpaCaptures } from "./RpaCaptures";
import { RpaCoordinateFallback } from "./RpaCoordinateFallback";
const labels = { find: "查找", read: "读取", click: "点击", fill: "填写", wait: "等待", screenshot: "截图" };
const errorCode = (error: unknown) => String(error).match(/BLK-RPA-[A-Z0-9-]+/)?.[0] ?? "BLK-RPA-PLAN-001";
export function RpaPanel({ close, projectId = "rpa-session", draft }: { close(): void; projectId?: string; draft?(plan:RpaPlan,browserUrl?:string):Promise<void> }) {
  const [kind,setKind]=useState<"windows"|"browser">("windows"),[url,setUrl]=useState(""),[role,setRole]=useState("button");
  const [targets, setTargets] = useState<RpaTarget[]>([]), [identity, setIdentity] = useState("");
  const [steps, setSteps] = useState<RpaStep[]>([]), [inputs, setInputs] = useState<Record<string, string>>({});
  const [action, setAction] = useState<RpaAction>("find"), [selector, setSelector] = useState("automationId"), [value, setValue] = useState("");
  const [busy, setBusy] = useState(false), [paused, setPaused] = useState(false), [message, setMessage] = useState("");
  const [recordingBusy, setRecordingBusy] = useState(false);
  const locked = busy || recordingBusy;
  const [events, setEvents] = useState<string[]>([]), [snapshot, setSnapshot] = useState<RpaStatus>();
  const [readResults, setReadResults] = useState<{ stepId: string; text: string }[]>([]);
  const session = useRef<string | undefined>(undefined), stopped = useRef(false), pause = useRef(false), mounted = useRef(true);
  const authorization = useRef<string | undefined>(undefined);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; stopped.current = true; if (session.current) void rpaNative.stop(session.current).catch(() => {}); if (authorization.current) void rpaNative.cancelAuthorization(authorization.current).catch(() => {}); };
  }, []);
  const refresh = async () => {
    try { setTargets(await rpaNative.targets()); setMessage(""); }
    catch (error) { setMessage(errorCode(error)); }
  };
  const add = () => {
    if (!(value.trim() || kind === "browser" && action === "screenshot") || steps.length >= 100) return;
    const stepId = `step-${crypto.randomUUID()}`;
    setSteps((current) => [...current, {
      stepId, action, timeoutMs: 5000,
      locator: kind==="browser" ? {kind:"browser",role,...(value.trim()?{name:value.trim()}:{})} : { kind: "uia", ...(selector === "automationId" ? { automationId: value.trim() } : { name: value.trim() }) },
      ...(action === "fill" ? { value: { kind: "manual-input" as const } } : {}),
      ...(["click", "fill"].includes(action) ? { effectKey: `effect-${crypto.randomUUID()}` } : {}),
    }]);
    setValue("");
  };
  const run = async (recoveryRun?: RpaRecoveryRun) => {
    if (locked) return;
    setBusy(true); setEvents([]); setReadResults([]); setSnapshot(undefined); setMessage("等待授权"); stopped.current = false; pause.current = false; setPaused(false);
    try {
      if(session.current){await rpaNative.stop(session.current);session.current=undefined;}
      const browser=!recoveryRun&&kind==="browser" ? rpaBrowserStartSchema.parse({projectId,url}) : undefined;
      const plan = recoveryRun?.plan ?? rpaPlanSchema.parse({ schemaVersion: "blocky.rpa/v1", planId: `plan-${crypto.randomUUID()}`, target: { kind, identity: browser ? new URL(browser.url).origin : identity }, steps });
      authorization.current = `approval-${crypto.randomUUID()}`;
      const grant = recoveryRun ? await rpaNative.recover(plan, recoveryRun.recovery, authorization.current) : await rpaNative.authorize(plan, authorization.current,browser);
      authorization.current = undefined;
      session.current = grant.sessionId;
      if (!mounted.current || stopped.current) { await rpaNative.stop(grant.sessionId); if (mounted.current) setMessage("已停止"); return; }
      setMessage("运行中");
      const nextStep = recoveryRun ? (await rpaNative.status(grant.sessionId)).nextStep : plan.steps[0].stepId;
      const start = plan.steps.findIndex((step) => step.stepId === nextStep);
      if (start < 0) throw Error("BLK-RPA-STATE-001");
      for (const step of plan.steps.slice(start)) {
        while (pause.current && !stopped.current) await new Promise((resolve) => setTimeout(resolve, 30));
        if (stopped.current) break;
        const result = await rpaNative.step(grant.sessionId, step.stepId, step.action === "fill" ? (recoveryRun?.inputs ?? inputs)[step.stepId] ?? "" : undefined);
        if (!mounted.current) break;
        setEvents((current) => [...current, `${labels[step.action]} · ${step.stepId} · 完成`].slice(-100));
        if (typeof result.text === "string") setReadResults((current) => [...current, { stepId: step.stepId, text: result.text as string }].slice(-100));
      }
      if (mounted.current) {
        const state = await rpaNative.status(grant.sessionId); setSnapshot(state);
        setMessage(state.status === "completed" ? "已完成" : state.status === "stopped" ? "已停止" : state.status);
      }
    } catch (error) {
      if (mounted.current) {
        setMessage(errorCode(error));
        if (session.current) { try { setSnapshot(await rpaNative.status(session.current)); } catch { /* original error remains visible */ } }
      }
    } finally {
      authorization.current = undefined;
      if (mounted.current) { setBusy(false); setPaused(false); setInputs({}); }
    }
  };
  const control = async (kind: "pause" | "resume" | "stop") => {
    if (!session.current) {
      if (kind === "stop") { stopped.current = true; if (authorization.current) { try { await rpaNative.cancelAuthorization(authorization.current); setMessage("已停止"); } catch (error) { setMessage(errorCode(error)); } } }
      return;
    }
    try {
      if (kind === "pause") { pause.current = true; await rpaNative.pause(session.current); setPaused(true); }
      if (kind === "resume") { await rpaNative.resume(session.current); pause.current = false; setPaused(false); }
      if (kind === "stop") { stopped.current = true; await rpaNative.stop(session.current); setMessage("已停止"); }
      setSnapshot(await rpaNative.status(session.current));
    } catch (error) { if (kind === "pause") { pause.current = false; setPaused(false); } setMessage(errorCode(error)); }
  };
  const preview = async()=>{
    try {const plan=rpaPlanSchema.parse({schemaVersion:"blocky.rpa/v1",planId:`plan-${crypto.randomUUID()}`,target:{kind,identity:kind==="browser"?new URL(rpaBrowserStartSchema.parse({projectId,url}).url).origin:identity},steps});
      await draft?.(plan,kind==="browser"?url:undefined);
    }catch(error){setMessage(errorCode(error));}
  };
  return <div className="popup-backdrop"><section className="popup rpa-panel" role="dialog" aria-modal="true" aria-label="桌面自动化">
    <header><strong>桌面自动化</strong><button aria-label="关闭桌面自动化" disabled={busy} onClick={close}>×</button></header>
    <p>选择目标并核对操作。运行时请保持在电脑旁；填写内容需逐步确认。</p>
    <fieldset disabled={locked}>
      <legend>目标与步骤</legend>
      <label>目标类型<select disabled={steps.length>0} value={kind} onChange={(e)=>setKind(e.target.value as "windows"|"browser")}><option value="windows">Windows 窗口</option><option value="browser">隔离浏览器</option></select></label>
      {kind==="windows" ? <><button onClick={() => void refresh()}>刷新窗口列表</button>
      <label>目标窗口<select aria-label="RPA 目标窗口" value={identity} onChange={(e) => setIdentity(e.target.value)}><option value="">请选择窗口</option>{targets.map((target) => <option key={target.identity} value={target.identity}>{target.title} · {target.processId}</option>)}</select></label></> : <><label>起始网址<input type="url" maxLength={4096} value={url} onChange={(e)=>setUrl(e.target.value)} /></label><p>使用新的 Edge 会话，仅访问起始来源；不沿用已有登录状态。关闭面板后回收会话。</p></>}
      <label>动作<select value={action} onChange={(e) => setAction(e.target.value as RpaAction)}>{(["find", "read", "click", "fill", "wait", "screenshot"] as const).map((key) => <option key={key} value={key}>{labels[key]}</option>)}</select></label>
      {kind==="browser" ? <label>控件角色<select value={role} onChange={(e)=>setRole(e.target.value)}>{["button","textbox","link","heading","status","checkbox","combobox","listitem","main","group","form"].map((name)=><option key={name}>{name}</option>)}</select></label> : <label>查找方式<select value={selector} onChange={(e) => setSelector(e.target.value)}><option value="automationId">控件标识</option><option value="name">控件名称</option></select></label>}
      <input aria-label="RPA 控件定位值" maxLength={200} value={value} onChange={(e) => setValue(e.target.value)} />
      <button disabled={!(value.trim() || kind === "browser" && action === "screenshot") || steps.length >= 100} onClick={add}>添加步骤</button>
      {kind === "browser" && <RpaCoordinateFallback disabled={locked || steps.length >= 100} add={step => setSteps(current => [...current, step])} />}
      <ol>{steps.map((step) => <li key={step.stepId}>{labels[step.action]} · {step.locator.kind === "uia" ? step.locator.automationId ?? step.locator.name : step.locator.kind==="browser" ? `${step.locator.role} ${step.locator.name??""}` : `高风险坐标 (${step.locator.x}, ${step.locator.y})`}
        {step.action === "fill" && <><label>敏感输入<input type="checkbox" aria-label={`敏感输入 ${step.stepId}`} checked={step.value?.sensitive === true} onChange={(e) => setSteps((current) => current.map((item) => item.stepId === step.stepId ? { ...item, value: { kind: "manual-input", ...(e.target.checked ? { sensitive: true } : {}) } } : item))} /></label>
          <label>填写内容<input type="password" aria-label={`填写内容 ${step.stepId}`} maxLength={16384} autoComplete="off" value={inputs[step.stepId] ?? ""} onChange={(e) => setInputs((current) => ({ ...current, [step.stepId]: e.target.value }))} /></label></>}
        <button aria-label={`删除步骤 ${step.stepId}`} onClick={() => setSteps((current) => current.filter((s) => s.stepId !== step.stepId))}>删除</button>
      </li>)}</ol>
    </fieldset>
    <RpaRecorder projectId={projectId} kind={kind} identity={identity} url={url} disabled={busy || !!snapshot?.active} busyChanged={setRecordingBusy} draft={draft} />
    <div className="rpa-controls"><button disabled={locked || !(kind==="browser"?url:identity) || !steps.length || snapshot?.active || snapshot?.receipts.some((r) => r.status === "uncertain")} onClick={() => void run()}>审阅并运行</button>
      {draft&&<button disabled={locked||!steps.length||!(kind==="browser"?url:identity)} onClick={()=>void preview()}>转为积木草案</button>}
      <button disabled={!busy || !session.current} onClick={() => void control(paused ? "resume" : "pause")}>{paused ? "继续" : "暂停"}</button>
      <button disabled={!busy} onClick={() => void control("stop")}>停止</button></div>
    <p role="status">{message}</p>
    <ol aria-label="自动化执行记录">{events.map((event, i) => <li key={i}>{event}</li>)}</ol>
    {readResults.length > 0 && <details><summary>读取结果</summary>{readResults.map((result) => <label key={result.stepId}>{result.stepId}<textarea readOnly value={result.text} /></label>)}</details>}
    {snapshot?.receipts.length ? <details><summary>操作回执</summary>{snapshot.receipts.map((receipt) => <p key={receipt.stepId}>{receipt.stepId}：{receipt.status === "completed" ? "调用已完成" : "结果待核对，请勿重复执行"}</p>)}</details> : null}
    <RpaCheckpoints disabled={locked} recover={run} />
    <RpaCaptures disabled={locked} />
  </section></div>;
}
