import { useEffect, useRef, useState } from "react";
import type { WorkflowSummary } from "@blocky/runtime-core";
import {
  workflowNative,
  type WorkflowReconciliation as Choice,
} from "../composition/workflow";
import { WorkflowReconciliation } from "./WorkflowReconciliation";
import { useWorkflowReview } from "./useWorkflowReview";
import type { ConfirmationLabels } from "../composition/useConfirmation";

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
  confirm(message: string, labels?: ConfirmationLabels): Promise<boolean>;
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
    [message, setMessage] = useState("");
  const mounted = useRef(false),
    scope = useRef(projectId),
    requestVersion = useRef(0);
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
  const { busy, review } = useWorkflowReview({
    projectId,
    refreshKey,
    disabled,
    confirm,
    validateTask,
    refresh,
    message: setMessage,
  });
  const decide = (task: WorkflowSummary, decision: "approve" | "reject") =>
    review(
      task,
      "审批",
      `${approvalLabel?.(task) ?? task.stepId ?? "工作流审批"}\n${decision === "approve" ? "批准后可继续任务。" : "拒绝后可继续执行已声明的补偿。"}`,
      (approval) =>
        approval
          ? workflowNative.decide(task, decision, approval)
          : workflowNative.decide(task, decision),
      {
        title: decision === "approve" ? "批准工作流步骤" : "拒绝工作流步骤",
        acceptLabel: decision === "approve" ? "确认批准" : "确认拒绝",
        rejectLabel: "取消",
      },
    );
  const reconcile = (task: WorkflowSummary, choice: Choice) =>
    review(
      task,
      "核对",
      `步骤 ${task.active?.stepId} · ${task.active?.direction === "rollback" ? "补偿" : "正向执行"}\n${choice.outcome === "completed" ? "确认已完成，并使用导入的检查点。" : "确认未执行，保留原检查点。"}保存后请自行选择是否继续任务。`,
      (approval) =>
        approval
          ? workflowNative.reconcile(task, choice, approval)
          : workflowNative.reconcile(task, choice),
      {
        title: "确认工作流核对",
        acceptLabel: "保存核对结果",
        rejectLabel: "取消",
      },
    );
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
          {!!task.resolutions.length && (
            <p>
              最近核对：{task.resolutions.at(-1)!.stepId} ·{" "}
              {task.resolutions.at(-1)!.direction === "rollback"
                ? "补偿"
                : "正向执行"}{" "}
              ·{" "}
              {task.resolutions.at(-1)!.outcome === "completed"
                ? "已完成"
                : "未执行"}
            </p>
          )}
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
            <>
              <p>需要人工核对，当前不能继续或重放此步骤。</p>
              {task.active && (
                <WorkflowReconciliation
                  key={`${projectId}:${refreshKey}:${task.taskId}:${task.revision}`}
                  disabled={disabled || busy}
                  onReview={(choice) => void reconcile(task, choice)}
                />
              )}
            </>
          )}
        </article>
      ))}
    </section>
  );
}
