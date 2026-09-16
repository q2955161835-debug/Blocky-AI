import type { StudioTask } from "../composition/useTask";
export function TaskPanel({ task: t }: { task: StudioTask }) {
  const status: Record<string, string> = {
    starting: "正在启动",
    running: "运行中",
    exited: "检查通过",
    failed: "检查失败",
    cancelled: "已停止",
    "timed-out": "已超时",
  };
  return (
    <div className="task-panel">
      <div className="task-controls">
        <strong>检查项目文件</strong>
        <label>
          次数
          <input
            aria-label="任务检查次数"
            type="number"
            min={1}
            max={360}
            value={t.passes}
            disabled={t.pending || t.active}
            onChange={(e) => t.setPasses(Number(e.target.value))}
          />
        </label>
        <label>
          间隔（毫秒）
          <input
            aria-label="任务间隔"
            type="number"
            min={0}
            max={1000}
            value={t.interval}
            disabled={t.pending || t.active}
            onChange={(e) => t.setIntervalMs(Number(e.target.value))}
          />
        </label>
        <label>
          超时（毫秒）
          <input
            aria-label="任务超时"
            type="number"
            min={1}
            max={30000}
            value={t.timeout}
            disabled={t.pending || t.active}
            onChange={(e) => t.setTimeoutMs(Number(e.target.value))}
          />
        </label>
        <label>
          输出上限（字节）
          <input
            aria-label="任务输出上限"
            type="number"
            min={256}
            max={65536}
            value={t.budget}
            disabled={t.pending || t.active}
            onChange={(e) => t.setBudget(Number(e.target.value))}
          />
        </label>
        <button disabled={t.pending || t.active} onClick={() => void t.start()}>
          运行检查
        </button>
        <button disabled={!t.active} onClick={() => void t.cancel()}>
          停止任务
        </button>
      </div>
      <div role="status">
        {t.state
          ? status[t.state.status]
          : t.pending
            ? "正在启动任务"
            : "选择参数后运行检查。"}
        {t.state?.exitCode !== null &&
          t.state?.exitCode !== undefined &&
          ` · 退出码 ${t.state.exitCode}`}
        {t.state?.truncated &&
          ` · 输出已截断，省略 ${t.state.droppedBytes} 字节`}
      </div>
      {t.state && <pre className="task-output">{t.state.output}</pre>}
    </div>
  );
}
