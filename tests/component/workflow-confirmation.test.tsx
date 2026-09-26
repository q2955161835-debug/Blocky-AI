// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
const io = vi.hoisted(() => ({
  list: vi.fn(),
  decide: vi.fn(),
  reconcile: vi.fn(),
}));
vi.mock("../../apps/studio-desktop/src/composition/workflow", () => ({
  workflowNative: io,
}));
import { WorkflowTasks } from "../../apps/studio-desktop/src/app/WorkflowTasks";
import { ConfirmationDialog } from "../../apps/studio-desktop/src/app/ConfirmationDialog";
import { useConfirmation } from "../../apps/studio-desktop/src/composition/useConfirmation";
import {
  createWorkflow,
  transitionWorkflow,
  workflowSummary,
} from "../../packages/runtime-core/src/workflow";
function ReviewHarness() {
  const review = useConfirmation();
  return (
    <>
      <WorkflowTasks
        projectId="project-confirm"
        refreshKey=""
        disabled={false}
        confirm={review.confirm}
        validateTask={async () => {}}
        onResume={() => {}}
        onLocate={() => {}}
      />
      {review.confirmation && (
        <ConfirmationDialog
          message={review.confirmation}
          labels={review.confirmationLabels}
          answer={review.answerConfirmation}
        />
      )}
    </>
  );
}
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  vi.restoreAllMocks();
});
it.each([
  ["批准", "批准工作流步骤", "确认批准"],
  ["拒绝", "拒绝工作流步骤", "确认拒绝"],
  ["核对", "确认工作流核对", "保存核对结果"],
])(
  "presents %s with its actual business meaning through the real dialog",
  async (action, title, accept) => {
    HTMLDialogElement.prototype.showModal = function () {
      this.setAttribute("open", "");
    };
    const record = createWorkflow(
      "task-confirm",
      {
        projectId: "project-confirm",
        moduleId: "main",
        blockId: "flow",
        planDigest: "a".repeat(64),
        runtimeVersion: 1,
        steps:
          action === "核对"
            ? [{ stepId: "step", kind: "action", compensate: false }]
            : [{ stepId: "step", kind: "approval", label: "业务审批" }],
      },
      null,
    );
    const task = workflowSummary(
      transitionWorkflow(record, {
        kind: action === "核对" ? "begin" : "await-approval",
        revision: 1,
      }),
    );
    io.list.mockResolvedValue([task]);
    io.decide.mockResolvedValue({ requestDigest: "b".repeat(64) });
    io.reconcile.mockResolvedValue({ requestDigest: "b".repeat(64) });
    render(<ReviewHarness />);
    if (action === "核对") {
      fireEvent.change(await screen.findByLabelText("核对结果"), {
        target: { value: "not-executed" },
      });
      fireEvent.click(screen.getByRole("button", { name: "预检核对" }));
    } else fireEvent.click(await screen.findByRole("button", { name: action }));
    expect(await screen.findByRole("dialog", { name: title })).toBeTruthy();
    expect(screen.getByRole("button", { name: accept })).toBeTruthy();
    expect(screen.queryByText("放弃修改并继续")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(io.decide.mock.calls.length + io.reconcile.mock.calls.length).toBe(
      1,
    );
  },
);
