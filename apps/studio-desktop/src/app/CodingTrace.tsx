import type { CodingEvent, CodingTool } from "@blocky/builder-protocol";

const toolNames: Record<CodingTool, string> = {
  workspace_list: "查看文件",
  workspace_search: "搜索代码",
  workspace_read: "读取文件",
  workspace_write: "编辑文件",
  workspace_undo: "撤回修改",
  blocky_cli: "运行 Blocky CLI",
  project_context: "查看项目",
};

/** Tool metadata stays outside the conversation; never render arguments or tool output. */
export function CodingTrace({
  events,
  busy,
  stopping,
}: {
  events: CodingEvent[];
  busy: boolean;
  stopping: boolean;
}) {
  const calls = new Map<string, CodingEvent>();
  for (const event of events) {
    if (!event.tool || !event.kind.startsWith("tool.")) continue;
    calls.set(event.callId ?? `event-${event.sequence}`, event);
  }
  if (!busy && !calls.size) return null;
  const latest = [...calls.values()].at(-1);
  const label = (event: CodingEvent) =>
    event.kind === "tool.started"
      ? "进行中"
      : event.kind === "tool.failed"
        ? "失败"
        : "已完成";
  return (
    <section className="coding-trace" aria-label="构建助手调用轨迹">
      {busy && (
        <p className="builder-chat-progress" role="status">
          {stopping
            ? "正在停止并结算任务…"
            : latest?.tool
              ? `${toolNames[latest.tool]} · ${label(latest)}`
              : "正在处理任务…"}
        </p>
      )}
      {calls.size > 0 && (
        <details className="coding-tool-history">
          <summary>调用轨迹 · {calls.size} 项操作</summary>
          <ol>
            {[...calls.entries()].map(([id, event]) => (
              <li key={id}>
                <span aria-hidden="true">
                  {event.kind === "tool.failed"
                    ? "!"
                    : event.kind === "tool.started"
                      ? "◌"
                      : "✓"}
                </span>{" "}
                {toolNames[event.tool!]} · {label(event)}
                {event.code && `（${event.code}）`}
              </li>
            ))}
          </ol>
        </details>
      )}
    </section>
  );
}
