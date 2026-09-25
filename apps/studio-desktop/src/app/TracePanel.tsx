import { useMemo, useState } from "react";
import { TraceSession } from "@blocky/observability";
import type { Studio } from "../composition/useStudio";

export function TracePanel({ studio: s, onContext }: { studio: Studio; onContext?(x: number, y: number): void }) {
  const [selectedSequence, setSelectedSequence] = useState<number>();
  const frames = useMemo(() => {
    const session = new TraceSession();
    for (const event of s.events) session.add(event);
    return session.list();
  }, [s.events]);
  const selectedIndex = Math.max(0, frames.findIndex((frame) => frame.sequence === selectedSequence));
  const selected = frames[selectedIndex];
  const choose = (index: number) => {
    const frame = frames[index];
    if (!frame) return;
    setSelectedSequence(frame.sequence);
    if (frame.moduleId)
      s.navigate({ projectId: frame.projectId, moduleId: frame.moduleId, blockId: frame.blockId });
  };
  return (
    <details className="trace">
      <summary>运行轨迹 · {frames.length} 个事件</summary>
      {s.droppedEvents > 0 && <p role="status">前 {s.droppedEvents} 个事件已丢弃；仅显示最近 500 个。</p>}
      <div className="trace-controls">
        <button disabled={selectedIndex <= 0} onClick={() => choose(selectedIndex - 1)}>上一步</button>
        <button disabled={selectedIndex >= frames.length - 1} onClick={() => choose(selectedIndex + 1)}>下一步</button>
        <span>历史回放只查看事件，不重新运行工具。</span>
      </div>
      <div className="trace-body">
        <div className="trace-events">
          {frames.map((frame, index) => (
            <button
              key={frame.sequence}
              aria-current={index === selectedIndex ? "step" : undefined}
              onClick={() => choose(index)}
              onContextMenu={(event) => {
                event.preventDefault();
                choose(index);
                onContext?.(event.clientX, event.clientY);
              }}
            >
              #{frame.sequence} {frame.type} <small>{frame.blockId ?? "项目"}</small>
            </button>
          ))}
        </div>
        {selected && (
          <div className="trace-detail">
            <strong>{selected.type}</strong>
            <p>来源：{selected.moduleId ?? "项目"}{selected.blockId ? ` / ${selected.blockId}` : ""}</p>
            {selected.correlationId && <p>关联：{selected.correlationId}</p>}
            {selected.code && <p>诊断：{selected.code}</p>}
            {selected.blockType && <p>积木类型：{selected.blockType}</p>}
            {selected.transport && <p>模型通道：{selected.transport}</p>}
            {selected.model && <p>返回模型：{selected.model}</p>}
            {selected.elapsedMs !== undefined && <p>耗时：{selected.elapsedMs} 毫秒</p>}
            {selected.outputBytes !== undefined && <p>输出字节数：{selected.outputBytes}</p>}
            {selected.resultCount !== undefined && <p>结果数：{selected.resultCount}</p>}
            {selected.inputPorts && <p>输入端口：{selected.inputPorts.join("、") || "无"}</p>}
            {selected.outputType && <p>输出类型：{selected.outputType}</p>}
            {selected.budget && <p>预算：步骤 {selected.budget.steps}，调用 {selected.budget.calls}，预留输出 Token {selected.budget.reservedOutputTokens}</p>}
            {selected.usage && <p>Token：输入 {selected.usage.inputTokens}，输出 {selected.usage.outputTokens}，合计 {selected.usage.totalTokens}</p>}
            {selected.redaction.applied && <p>已脱敏：{selected.redaction.categories.join("、")}</p>}
          </div>
        )}
      </div>
    </details>
  );
}
