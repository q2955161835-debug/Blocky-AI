import { useEffect, useRef, useState } from "react";
import type { WorkflowSummary } from "@blocky/runtime-core";
import type { ConfirmationLabels } from "../composition/useConfirmation";

/** A confirmation cannot survive a project/run change, including switching away and back. */
export function useWorkflowReview({
  projectId,
  refreshKey,
  disabled,
  confirm,
  validateTask,
  refresh,
  message,
}: {
  projectId: string;
  refreshKey: string;
  disabled: boolean;
  confirm(text: string, labels?: ConfirmationLabels): Promise<boolean>;
  validateTask(task: WorkflowSummary): Promise<void>;
  refresh(): Promise<void>;
  message(text: string): void;
}) {
  const [busy, setBusy] = useState(false),
    active = useRef(false),
    mounted = useRef(false);
  const scope = useRef({ projectId, refreshKey, disabled, epoch: 0 });
  if (
    scope.current.projectId !== projectId ||
    scope.current.refreshKey !== refreshKey ||
    scope.current.disabled !== disabled
  )
    scope.current = {
      projectId,
      refreshKey,
      disabled,
      epoch: scope.current.epoch + 1,
    };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      scope.current.epoch++;
    };
  }, []);
  const review = async (
    task: WorkflowSummary,
    label: string,
    explanation: string,
    send: (approval?: string) => Promise<{ requestDigest: string }>,
    confirmationLabels: ConfirmationLabels,
  ) => {
    if (disabled || active.current) return;
    active.current = true;
    setBusy(true);
    const epoch = scope.current.epoch,
      current = () =>
        mounted.current &&
        scope.current.epoch === epoch &&
        !scope.current.disabled;
    let dispatched = false;
    try {
      await validateTask(task);
      if (!current()) return;
      const preview = await send();
      if (!current()) return;
      const accepted = await confirm(
        `${explanation}\n任务 ${task.taskId} · 修订 ${task.revision}`,
        confirmationLabels,
      );
      if (!accepted || !current()) return;
      await validateTask(task);
      if (!current()) return;
      dispatched = true;
      await send(preview.requestDigest);
      if (current()) await refresh();
    } catch {
      if (current())
        message(
          dispatched
            ? `${label}结果未确认，请刷新任务核对当前状态，不要直接重发决定。`
            : `${label}未应用：任务、项目或资源已改变，或执行尚未确认停止，请核对后刷新。`,
        );
    } finally {
      active.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  return { busy, review };
}
