import type { ReactNode } from "react";
import type { Studio } from "../composition/useStudio";
import { interactionKey } from "@blocky/language-schema";
import { RunModelChoice } from "./RunModelChoice";
import { RunBudgetSummary } from "./RunBudgetSummary";
import { WorkflowTasks } from "./WorkflowTasks";
import { findBlock } from "@blocky/project-model";
export function RunSettings({
  studio: s,
  execute,
  children,
}: {
  studio: Studio;
  execute(id: string): void;
  children?: ReactNode;
}) {
  const entries = s.compiled?.interaction.entries ?? [];
  return (
    <>
      <RunModelChoice studio={s} />
      <RunBudgetSummary project={s.snapshot.project} />
      {entries.length > 1 && (
        <label className="prompt-label">
          运行入口
          <select
            aria-label="运行入口"
            value={s.interactionId}
            disabled={s.running || s.busy}
            onChange={(event) => s.setInteractionId(event.target.value)}
          >
            {entries.map((entry) => (
              <option key={interactionKey(entry)} value={interactionKey(entry)}>
                {entry.displayName} ·{" "}
                {
                  s.snapshot.project.manifest.modules.find(
                    (module) => module.moduleId === entry.moduleId,
                  )?.displayName
                }
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="chat-debug-actions">
        {" "}
        {s.running && (
          <button onClick={() => execute("run.pause")}>
            {s.paused ? "继续" : "暂停"}
          </button>
        )}
        {s.running && s.paused && (
          <button onClick={() => execute("run.step")}>单步</button>
        )}
        {!s.running && s.selected && (
          <button onClick={() => execute("run.from-selection")}>
            从所选处运行
          </button>
        )}
        {!s.running && s.selected && (
          <button onClick={() => execute("run.toggle-breakpoint")}>
            {s.breakpoints.some(
              (item) =>
                item.moduleId === s.session.active &&
                item.blockId === s.selected,
            )
              ? "移除断点"
              : "设置断点"}
          </button>
        )}
      </div>
      <WorkflowTasks
        key={s.snapshot.project.manifest.projectId}
        projectId={s.snapshot.project.manifest.projectId}
        refreshKey={`${s.result?.workflow?.taskId ?? ""}:${s.result?.workflow?.revision ?? ""}:${s.running}`}
        disabled={
          s.exiting ||
          s.busy ||
          s.running ||
          s.compiling ||
          !s.interactionId ||
          !!s.compiled?.diagnostics.some((d) => d.severity === "error")
        }
        confirm={s.confirm}
        validateTask={s.validateWorkflow}
        onResume={(task) => void s.resumeWorkflow(task)}
        onLocate={(task) =>
          s.navigate({
            projectId: task.projectId,
            moduleId: task.moduleId,
            blockId: task.stepId ?? task.blockId,
          })
        }
        approvalLabel={(task) => {
          const label = findBlock(
            s.snapshot.project.workspaces[task.moduleId]?.blocks.blocks ?? [],
            task.stepId ?? "",
          )?.fields?.LABEL;
          return typeof label === "string"
            ? label
            : (task.stepId ?? "工作流审批");
        }}
      />
      {children}
    </>
  );
}
