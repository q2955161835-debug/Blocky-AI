// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
const io = vi.hoisted(() => ({
  list: vi.fn(),
  decide: vi.fn(),
  reconcile: vi.fn(),
}));
vi.mock("../../apps/studio-desktop/src/composition/workflow", () => ({
  workflowNative: io,
}));
import { WorkflowTasks } from "../../apps/studio-desktop/src/app/WorkflowTasks";
import {
  createWorkflow,
  transitionWorkflow,
  workflowSummary,
} from "../../packages/runtime-core/src/workflow";
const begun = transitionWorkflow(
  createWorkflow(
    "task-check",
    {
      projectId: "project-check",
      moduleId: "main",
      blockId: "flow",
      planDigest: "a".repeat(64),
      runtimeVersion: 1,
      steps: [{ stepId: "effect", kind: "action", compensate: true }],
    },
    null,
  ),
  { kind: "begin", revision: 1 },
);
const task = workflowSummary(begun),
  digest = "b".repeat(64);
function setup() {
  io.list.mockResolvedValue([task]);
  io.reconcile.mockResolvedValue({
    applied: false,
    requestDigest: digest,
    task,
  });
  return {
    projectId: task.projectId,
    refreshKey: "",
    disabled: false,
    confirm: vi.fn(async (_message: string) => true),
    validateTask: vi.fn(async () => {}),
    onResume: vi.fn(),
    onLocate: vi.fn(),
  };
}
function choose(outcome = "not-executed") {
  fireEvent.change(screen.getByLabelText("核对结果"), {
    target: { value: outcome },
  });
}
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
it("preflights an explicit outcome, confirms, revalidates and refreshes without replay", async () => {
  const props = setup();
  render(<WorkflowTasks {...props} />);
  await screen.findByLabelText("核对结果");
  choose();
  fireEvent.click(screen.getByRole("button", { name: "预检核对" }));
  await waitFor(() => expect(io.reconcile).toHaveBeenCalledTimes(2));
  expect(io.reconcile.mock.calls).toEqual([
    [task, { outcome: "not-executed" }],
    [task, { outcome: "not-executed" }, digest],
  ]);
  expect(props.validateTask).toHaveBeenCalledTimes(2);
  expect(props.confirm.mock.calls[0][0]).toContain("未执行");
  expect(props.confirm.mock.calls[0][0]).toContain("effect");
  expect(io.list).toHaveBeenCalledTimes(2);
  expect(props.onResume).not.toHaveBeenCalled();
});
it("requires an imported checkpoint for completed and never puts its body in confirmation", async () => {
  const props = setup();
  render(<WorkflowTasks {...props} />);
  await screen.findByLabelText("核对结果");
  choose("completed");
  expect(
    (screen.getByRole("button", { name: "预检核对" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  fireEvent.change(screen.getByLabelText("核对后的检查点"), {
    target: {
      files: [
        new File(['{"private":"reconcile-canary"}'], "checked.json", {
          type: "application/json",
        }),
      ],
    },
  });
  await waitFor(() =>
    expect(
      (screen.getByRole("button", { name: "预检核对" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false),
  );
  fireEvent.click(screen.getByRole("button", { name: "预检核对" }));
  await waitFor(() => expect(io.reconcile).toHaveBeenCalledTimes(2));
  expect(io.reconcile.mock.calls[1][1]).toEqual({
    outcome: "completed",
    state: { private: "reconcile-canary" },
  });
  expect(props.confirm.mock.calls[0][0]).not.toContain("reconcile-canary");
  expect(screen.queryByText(/reconcile-canary/)).toBeNull();
});
it.each(["malformed", "oversized"])(
  "rejects %s imported state before preflight",
  async (kind) => {
    const props = setup();
    render(<WorkflowTasks {...props} />);
    await screen.findByLabelText("核对结果");
    choose("completed");
    fireEvent.change(screen.getByLabelText("核对后的检查点"), {
      target: {
        files: [
          new File(
            [
              kind === "oversized"
                ? " ".repeat(131073)
                : "private-invalid-json",
            ],
            "checked.json",
          ),
        ],
      },
    });
    await screen.findByText(/检查点无效/);
    expect(io.reconcile).not.toHaveBeenCalled();
    expect(screen.queryByText(/private-invalid-json/)).toBeNull();
  },
);
it.each(["project", "revision", "disabled", "unmount"])(
  "invalidates pending confirmation on %s, even when switched back",
  async (kind) => {
    const props = setup();
    let answer!: (accepted: boolean) => void;
    props.confirm.mockImplementation(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    const view = render(<WorkflowTasks {...props} />);
    await screen.findByLabelText("核对结果");
    choose();
    fireEvent.click(screen.getByRole("button", { name: "预检核对" }));
    await waitFor(() => expect(props.confirm).toHaveBeenCalledOnce());
    if (kind === "unmount") view.unmount();
    else {
      view.rerender(
        <WorkflowTasks
          {...props}
          {...(kind === "project"
            ? { projectId: "other" }
            : kind === "revision"
              ? { refreshKey: "changed" }
              : { disabled: true })}
        />,
      );
      view.rerender(<WorkflowTasks {...props} />);
    }
    await act(async () => answer(true));
    expect(io.reconcile).toHaveBeenCalledOnce();
    expect(props.onResume).not.toHaveBeenCalled();
  },
);
it("rejects a changed resource after confirmation", async () => {
  const props = setup();
  props.validateTask
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(Error("binding"));
  render(<WorkflowTasks {...props} />);
  await screen.findByLabelText("核对结果");
  choose();
  fireEvent.click(screen.getByRole("button", { name: "预检核对" }));
  await screen.findByText(/核对未应用/);
  expect(io.reconcile).toHaveBeenCalledOnce();
});
it("keeps a lost acknowledgement uncertain without leaking or retrying", async () => {
  const props = setup();
  io.reconcile
    .mockResolvedValueOnce({ applied: false, requestDigest: digest, task })
    .mockRejectedValueOnce(Error("private-canary"));
  render(<WorkflowTasks {...props} />);
  await screen.findByLabelText("核对结果");
  choose();
  fireEvent.click(screen.getByRole("button", { name: "预检核对" }));
  await screen.findByText(/核对结果未确认/);
  expect(io.reconcile).toHaveBeenCalledTimes(2);
  expect(screen.queryByText(/private-canary/)).toBeNull();
});
