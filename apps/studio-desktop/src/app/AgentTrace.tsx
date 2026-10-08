import type { CodingMessage } from "@blocky/builder-protocol";
import { CodingTrace } from "./CodingTrace";
const statuses = { started: "已发起", completed: "已完成", failed: "失败", cancelled: "已停止" };
/** Display only archived Runtime identities and real returned thinking. */
export function AgentTrace({ message }: { message?: CodingMessage }) {
  if (!message) return null;
  const calls = message.runtimeActivity ?? [];
  const removed = message.runtimeActivityTruncated ?? 0;
  return <>
    <CodingTrace label="Blocky Agent 思考与调用轨迹" activity={message.activity} thinking={message.thinking}
      activityTruncated={message.activityTruncated} thinkingTruncated={message.thinkingTruncated} />
    {(calls.length > 0 || removed > 0) && <details className="coding-tool-history" aria-label="Blocky Agent 运行调用轨迹">
      <summary>调用轨迹 · {calls.length} 项操作{removed > 0 ? ` · ${removed} 项较早操作已裁剪` : ""}</summary>
      <ol>{calls.map(call => <li key={call.callId} data-call-state={call.status}>
        {call.kind === "model" ? "模型调用" : call.toolId ?? "工具调用"} · {statuses[call.status]}
        {call.operation && <code className="coding-command">{call.operation}</code>}
        {call.code && `（${call.code}）`}
      </li>)}</ol>
    </details>}
  </>;
}
