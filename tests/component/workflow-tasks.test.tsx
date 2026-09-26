// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
const io = vi.hoisted(() => ({ list: vi.fn(), decide: vi.fn() }));
vi.mock("../../apps/studio-desktop/src/composition/workflow", () => ({
  workflowNative: io,
}));
import { WorkflowTasks } from "../../apps/studio-desktop/src/app/WorkflowTasks";
import {
  createWorkflow,
  workflowSummary,
  transitionWorkflow,
} from "../../packages/runtime-core/src/workflow";
const record = createWorkflow(
  "task-test",
  {
    projectId: "project-test",
    moduleId: "main",
    blockId: "flow",
    planDigest: "a".repeat(64),
    runtimeVersion: 1,
    steps: [{ stepId: "review", kind: "approval", label: "业务确认" }],
  },
  null,
);
const waiting = workflowSummary(
  transitionWorkflow(record, { kind: "await-approval", revision: 1 }),
);
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
it("rechecks project and resource binding after confirmation before applying", async () => {
  io.list.mockResolvedValue([waiting]);
  io.decide.mockResolvedValue({applied:false,requestDigest:"b".repeat(64),task:waiting});
  const validate=vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(Error("BLK-WORKFLOW-BINDING"));
  render(<WorkflowTasks projectId="project-test" disabled={false} refreshKey="" confirm={async()=>true} validateTask={validate} onResume={()=>{}} onLocate={()=>{}}/>);
  fireEvent.click(await screen.findByRole("button",{name:"批准"}));
  await screen.findByText(/任务、项目或资源已改变/);
  expect(validate).toHaveBeenCalledTimes(2);
  expect(io.decide).toHaveBeenCalledTimes(1);
});
it("previews and explicitly confirms a bound decision without automatically running", async () => {
  io.list.mockResolvedValue([waiting]);
  io.decide
    .mockResolvedValueOnce({
      applied: false,
      requestDigest: "b".repeat(64),
      task: waiting,
    })
    .mockResolvedValueOnce({ applied: true });
  const confirm = vi.fn(async (_message: string) => true),
    resume = vi.fn();
  render(
    <WorkflowTasks
      projectId="project-test"
      disabled={false}
      refreshKey=""
      confirm={confirm}
      validateTask={async () => {}}
      onResume={resume}
      onLocate={() => {}}
      approvalLabel={() => "业务确认"}
    />,
  );
  fireEvent.click(await screen.findByRole("button", { name: "批准" }));
  await waitFor(() => expect(io.decide).toHaveBeenCalledTimes(2));
  expect(io.decide.mock.calls[0]).toEqual([waiting, "approve"]);
  expect(io.decide.mock.calls[1]).toEqual([waiting, "approve", "b".repeat(64)]);
  expect(confirm.mock.calls[0][0]).toContain("业务确认");
  expect(resume).not.toHaveBeenCalled();
});
it("does not apply approval after the project panel unmounts", async () => {
  io.list.mockResolvedValue([waiting]);
  io.decide.mockResolvedValue({
    applied: false,
    requestDigest: "b".repeat(64),
    task: waiting,
  });
  let answer!: (value: boolean) => void;
  const confirm = vi.fn(
    () =>
      new Promise<boolean>((resolve) => {
        answer = resolve;
      }),
  );
  const view = render(
    <WorkflowTasks
      projectId="project-test"
      disabled={false}
      refreshKey=""
      confirm={confirm}
      validateTask={async () => {}}
      onResume={() => {}}
      onLocate={() => {}}
    />,
  );
  fireEvent.click(await screen.findByRole("button", { name: "拒绝" }));
  await waitFor(() => expect(confirm).toHaveBeenCalledOnce());
  view.unmount();
  answer(true);
  await Promise.resolve();
  await Promise.resolve();
  expect(io.decide).toHaveBeenCalledTimes(1);
});
it("offers explicit continuation only for safe persisted boundaries", async () => {
  const ready = workflowSummary(record);
  io.list.mockResolvedValue([
    ready,
    { ...ready, taskId: "task-unknown", status: "uncertain" },
  ]);
  const resume = vi.fn();
  render(
    <WorkflowTasks
      projectId="project-test"
      disabled={false}
      refreshKey=""
      confirm={async () => true}
      validateTask={async () => {}}
      onResume={resume}
      onLocate={() => {}}
    />,
  );
  fireEvent.click(await screen.findByRole("button", { name: "继续任务" }));
  expect(resume).toHaveBeenCalledWith(ready);
  expect(screen.queryAllByRole("button", { name: "继续任务" })).toHaveLength(1);
  expect(screen.getByText(/需要人工核对/)).toBeTruthy();
});
