import { useEffect, useRef, useState } from "react";
import type { WorkflowSummary } from "@blocky/runtime-core";
import { workflowNative } from "../composition/workflow";

const labels: Record<WorkflowSummary["status"], string> = {
  ready: "可继续",
  executing: "执行意图待核对",
  "awaiting-approval": "等待审批",
  paused: "已暂停",
  compensating: "待继续补偿",
  undoing: "补偿意图待核对",
  uncertain: "效果不确定",
  completed: "已完成",
  compensated: "已补偿",
};
type Props = {
  projectId: string;
  refreshKey: string;
  disabled: boolean;
  confirm(message: string): Promise<boolean>;
  validateTask(task: WorkflowSummary): Promise<void>;
  onResume(task: WorkflowSummary): void;
  onLocate(task: WorkflowSummary): void;
  approvalLabel?(task: WorkflowSummary): string;
};
export function WorkflowTasks({
  projectId,
  refreshKey,
  disabled,
  confirm,
  validateTask,
  onResume,
  onLocate,
  approvalLabel,
}: Props) {
  const [tasks, setTasks] = useState<WorkflowSummary[]>([]),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const mounted = useRef(false),
    scope = useRef(projectId),
    requestVersion = useRef(0),
    actionBusy = useRef(false);
  scope.current = projectId;
  const refresh = async () => {
    const version = ++requestVersion.current;
    try {
      const result = await workflowNative.list(projectId);
      if (
        mounted.current &&
        scope.current === projectId &&
        version === requestVersion.current
      ) {
        setTasks(result);
        setMessage("");
      }
    } catch {
      if (
        mounted.current &&
        scope.current === projectId &&
        version === requestVersion.current
      ) {
        setTasks([]);
        setMessage("无法读取工作流任务，请检查当前资料目录。");
      }
    }
  };
  useEffect(() => {
    mounted.current = true;
    setTasks([]);
    void refresh();
    return () => {
      mounted.current = false;
      requestVersion.current++;
    };
  }, [projectId, refreshKey]);
  const decide = async (
    task: WorkflowSummary,
    decision: "approve" | "reject",
  ) => {
    if (disabled || actionBusy.current) return;
    actionBusy.current = true;
    setBusy(true);
    const current = () => mounted.current && scope.current === projectId;
    let applicationRequested = false;
    try {
      await validateTask(task);
      if (!current()) return;
      const preview = await workflowNative.decide(task, decision);
      if (!current()) return;
      const text =
        decision === "approve"
          ? "批准后可继续任务。"
          : "拒绝后可继续执行已声明的补偿。";
      const accepted = await confirm(
        `${approvalLabel?.(task) ?? task.stepId ?? "工作流审批"}\n任务 ${task.taskId} · 修订 ${task.revision}\n${text}`,
      );
      if (!accepted || !current()) return;
      await validateTask(task);
      if (!current()) return;
      applicationRequested = true;
      await workflowNative.decide(task, decision, preview.requestDigest);
      if (current()) await refresh();
    } catch {
      if (current())
        setMessage(
          applicationRequested
            ? "审批结果未确认，请刷新任务核对当前状态，不要直接重发决定。"
            : "审批未应用：任务、项目或资源已改变，请恢复对应版本并刷新后重试。",
        );
    } finally {
      actionBusy.current = false;
      if (current()) setBusy(false);
    }
  };
  return (
    <section aria-label="工作流任务">
      <div className="section-label">
        工作流任务{" "}
        <button disabled={disabled || busy} onClick={() => void refresh()}>
          刷新任务
        </button>
      </div>
      {message && <p role="status">{message}</p>}
      {!tasks.length && !message && (
        <p className="muted">当前项目没有已保存的工作流任务。</p>
      )}
      {tasks.map((task) => (
        <article key={task.taskId} className="answer">
          <p>
            {labels[task.status]} · {task.forwardCursor}/{task.totalSteps}
          </p>
          <p className="muted">
            {task.taskId} · 修订 {task.revision}
          </p>
          {task.status === "awaiting-approval" && (
            <p>{approvalLabel?.(task) ?? task.stepId}</p>
          )}
          <div className="run-actions">
            <button disabled={disabled || busy} onClick={() => onLocate(task)}>
              定位积木
            </button>
            {task.status === "awaiting-approval" && (
              <>
                <button
                  disabled={disabled || busy}
                  onClick={() => void decide(task, "approve")}
                >
                  批准
                </button>
                <button
                  disabled={disabled || busy}
                  onClick={() => void decide(task, "reject")}
                >
                  拒绝
                </button>
              </>
            )}
            {["ready", "paused", "compensating"].includes(task.status) && (
              <button
                disabled={disabled || busy}
                onClick={() => onResume(task)}
              >
                继续任务
              </button>
            )}
          </div>
          {["executing", "undoing", "uncertain"].includes(task.status) && (
            <p>需要人工核对，当前不能继续或重放此步骤。</p>
          )}
        </article>
      ))}
    </section>
  );
}
