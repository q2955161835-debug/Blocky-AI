import type { TraceDetails as Details } from "@blocky/observability";

export function TraceDetails({ details }: { details?: Details }) {
  if (!details) return null;
  const { context, model, memory, tool, guard, rpa } = details;
  const decision = { configured: "已配置", checking: "核验中", passed: "通过", rejected: "拒绝", "insufficient-evidence": "资料不足，未调用模型" };
  return <>
    {rpa && <p>自动化：{rpa.targetKind === "browser" ? "隔离浏览器" : "Windows 窗口"} / {{authorized:"已授权",performing:"执行中",completed:"已完成"}[rpa.phase]}{rpa.action ? ` / ${{find:"查找",read:"读取",click:"点击",fill:"填写",wait:"等待",screenshot:"截图"}[rpa.action]}` : ""}{rpa.locatorKind ? ` / ${rpa.locatorKind}` : ""}{rpa.checkpointId ? `；检查点 ${rpa.checkpointId}` : ""}</p>}
    {context && <p>上下文（字节）：角色 {context.roleBytes}，指令 {context.instructionBytes}，用户输入 {context.userBytes}，记忆 {context.memoryBytes}，工具结果 {context.resultBytes}；证据 {context.evidenceCount} 条 / {context.evidenceBytes} 字节</p>}
    {model && <p>本次模型参数：输出 Token 上限 {model.maxOutputTokens}</p>}
    {memory && <p>记忆：{memory.scope === "session" ? "会话" : "项目"} / {{ read: "读取", write: "写入", delete: "删除" }[memory.action]}</p>}
    {tool && <p>工具参数：{tool.source === "input" ? "用户输入" : "前一步结果"} / {tool.inputType} / {tool.inputBytes} 字节{tool.outputType ? `；结果 ${tool.outputType} / ${tool.outputBytes ?? 0} 字节` : ""}</p>}
    {guard && <p>证据护栏：{guard.policy === "require" ? "必需" : "可选"} / {decision[guard.decision]}</p>}
  </>;
}
