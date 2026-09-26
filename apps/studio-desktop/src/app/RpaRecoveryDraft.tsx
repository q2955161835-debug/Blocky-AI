import { useState } from "react";
import { rpaRecoverySchema } from "@blocky/rpa-core";
import type { RpaRecoveryPreview, RpaRecoveryRun } from "../composition/rpa";

type Condition = { selector: "automationId" | "name"; value: string; kind: "exists" | "text"; text: string };
export function RpaRecoveryDraft({ preview, disabled, run, close }: { preview: RpaRecoveryPreview; disabled: boolean; run(value: RpaRecoveryRun): Promise<void>; close(): void }) {
  const [conditions, setConditions] = useState<Record<string, Condition>>(() => Object.fromEntries(preview.checkpoint.receipts.map((r) => [r.stepId, { selector: "automationId", value: "", kind: "exists", text: "" }])));
  const [inputs, setInputs] = useState<Record<string, string>>({}), [message, setMessage] = useState("");
  const update = (id: string, change: Partial<Condition>) => setConditions((current) => ({ ...current, [id]: { ...current[id], ...change } }));
  const submit = async () => {
    const parsed = rpaRecoverySchema.safeParse({ schemaVersion: "blocky.rpa-recovery/v1", checkpointId: preview.checkpoint.checkpointId, revision: preview.checkpoint.revision,
      checks: preview.checkpoint.receipts.map((receipt) => { const condition = conditions[receipt.stepId]; return { stepId: receipt.stepId, locator: { kind: "uia", [condition.selector]: condition.value.trim() }, ...(condition.kind === "text" ? { expectedText: condition.text } : {}) }; }),
    });
    if (!parsed.success) { setMessage("请为每个已完成操作填写有效的状态核对条件。"); return; }
    const temporaryInputs = inputs;
    setInputs({}); setMessage("");
    await run({ plan: preview.plan, recovery: parsed.data, inputs: temporaryInputs });
    close();
  };
  return <fieldset disabled={disabled} aria-label="恢复前核对">
    <legend>恢复前核对</legend>
    <p>{preview.plan.planId}：已完成 {preview.checkpoint.completedSteps} 步，将从下一步继续。</p>
    {preview.checkpoint.receipts.map((receipt) => { const condition = conditions[receipt.stepId]; return <fieldset key={receipt.stepId}>
      <legend>核对 {receipt.stepId} 的完成结果</legend>
      <label>查找方式<select value={condition.selector} onChange={(e) => update(receipt.stepId, { selector: e.target.value as Condition["selector"] })}><option value="automationId">控件标识</option><option value="name">控件名称</option></select></label>
      <input aria-label={`恢复控件 ${receipt.stepId}`} maxLength={200} value={condition.value} onChange={(e) => update(receipt.stepId, { value: e.target.value })} />
      <label>预期状态<select value={condition.kind} onChange={(e) => update(receipt.stepId, { kind: e.target.value as Condition["kind"] })}><option value="exists">控件存在</option><option value="text">文本等于</option></select></label>
      {condition.kind === "text" && <input aria-label={`预期文本 ${receipt.stepId}`} maxLength={1024} autoComplete="off" value={condition.text} onChange={(e) => update(receipt.stepId, { text: e.target.value })} />}
    </fieldset>; })}
    <ol>{preview.plan.steps.slice(preview.checkpoint.completedSteps).map((step) => <li key={step.stepId}>{step.stepId}
      {step.action === "fill" && <label>{step.value?.sensitive ? "重新提供敏感输入" : "重新提供填写内容"}<input type="password" aria-label={`恢复填写 ${step.stepId}`} maxLength={16384} autoComplete="off" value={inputs[step.stepId] ?? ""} onChange={(e) => setInputs((current) => ({ ...current, [step.stepId]: e.target.value }))} /></label>}
    </li>)}</ol>
    <p aria-live="polite">{message}</p>
    <button onClick={() => void submit()}>核对并申请恢复</button><button onClick={close}>取消恢复</button>
  </fieldset>;
}
