import type {
  CodingActivity,
  CodingEvent,
  CodingTool,
} from "@blocky/builder-protocol";
import { updateCodingActivity } from "../composition/codingActivity";
const toolNames: Record<CodingTool, string> = {
  workspace_list: "查看文件",
  workspace_search: "搜索代码",
  workspace_read: "读取文件",
  workspace_write: "编辑文件",
  workspace_undo: "撤回修改",
  workspace_check: "检查代码",
  blocky_cli: "运行 Blocky CLI",
  project_context: "查看项目",
};
const statusTitles = {
  started: "进行中",
  completed: "已完成",
  failed: "失败",
  cancelled: "已停止",
};
/** Each reply owns its thinking and safe call metadata in the same scrolling flow. */
export function CodingTrace({
  events,
  activity,
  thinking,
  busy = false,
  stopping = false,
  activityTruncated = 0,
  thinkingTruncated = false,
  label = "构建助手调用轨迹",
}: {
  events?: CodingEvent[];
  activity?: CodingActivity[];
  thinking?: string;
  busy?: boolean;
  stopping?: boolean;
  activityTruncated?: number;
  thinkingTruncated?: boolean;
  label?: string;
}) {
  const calls =
    activity ??
    (events ?? []).reduce(
      (previous, event) => updateCodingActivity(previous, event).activity,
      [] as CodingActivity[],
    );
  if (
    !busy &&
    !calls.length &&
    !thinking &&
    !activityTruncated &&
    !thinkingTruncated
  )
    return null;
  const latest = calls.at(-1);
  return (
    <section className="coding-trace" aria-label={label}>
      {busy && (
        <p className="builder-chat-progress" role="status">
          {stopping
            ? "正在停止并结算任务…"
            : latest
              ? `${toolNames[latest.tool]} · ${statusTitles[latest.status]}`
              : "正在处理任务…"}
        </p>
      )}
      {(thinking || thinkingTruncated) && (
        <details className="coding-thinking" open={busy || undefined}>
          <summary>思考{busy ? " · 进行中" : ""}</summary>
          {thinking && <p className="coding-thinking-text">{thinking}</p>}
          {thinkingTruncated && (
            <p className="coding-history-note">思考记录已截断</p>
          )}
        </details>
      )}
      {(calls.length > 0 || activityTruncated > 0) && (
        <details className="coding-tool-history">
          <summary>
            调用轨迹 · {calls.length} 项操作
            {activityTruncated
              ? ` · ${activityTruncated} 项较早操作已裁剪`
              : ""}
          </summary>
          <ol>
            {calls.map((call) => (
              <li key={call.callId} data-call-state={call.status}>
                <span aria-hidden="true">
                  {call.status === "failed"
                    ? "!"
                    : call.status === "started"
                      ? "◌"
                      : call.status === "cancelled"
                        ? "■"
                        : "✓"}
                </span>{" "}
                {toolNames[call.tool]} · {statusTitles[call.status]}
                {call.code && `（${call.code}）`}
                {call.command && (
                  <code className="coding-command">{call.command}</code>
                )}
                {call.exitCode !== undefined && (
                  <small className="coding-exit-code">
                    退出码 {call.exitCode}
                  </small>
                )}
              </li>
            ))}
          </ol>
        </details>
      )}
    </section>
  );
}
