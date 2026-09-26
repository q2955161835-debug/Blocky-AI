import { afterEach, beforeEach, expect, it, vi } from "vitest";
const io = vi.hoisted(() => ({ invoke: vi.fn() }));
beforeEach(() =>
  vi.stubGlobal("window", { __TAURI_INTERNALS__: { invoke: io.invoke } }),
);
import { studioWorkflowPorts } from "../../apps/studio-desktop/src/composition/workflow";
import {
  createWorkflow,
  transitionWorkflow,
} from "../../packages/runtime-core/src/workflow";
const initial = createWorkflow(
  "task-test",
  {
    projectId: "project-test",
    moduleId: "main",
    blockId: "flow",
    planDigest: "a".repeat(64),
    runtimeVersion: 1,
    steps: [{ stepId: "effect", kind: "action", compensate: false }],
  },
  null,
);
const sessionId = "session-11111111-1111-4111-8111-111111111111";
afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});
it("settles a native lease returned after opening was cancelled", async () => {
  let ready!: (value: unknown) => void;
  io.invoke.mockImplementation((command: string, { request }: any) =>
    command === "workflow_open"
      ? new Promise((resolve) => {
          ready = resolve;
        })
      : Promise.resolve(
          request.operation === "close" ? { released: true } : null,
        ),
  );
  const ctl = new AbortController(),
    opening = studioWorkflowPorts().open(
      { definition: initial.definition, initial: null },
      ctl.signal,
    );
  ctl.abort();
  ready({ sessionId, record: initial });
  await expect(opening).rejects.toThrow();
  expect(io.invoke.mock.calls.map((c) => c[1].request.operation)).toEqual([
    undefined,
    "cancel",
    "close",
  ]);
});
it("blocks new work after cancellation but drains an already completed native receipt before close", async () => {
  let saved = initial,
    acknowledge!: (value: unknown) => void;
  io.invoke.mockImplementation(async (command: string, { request }: any) => {
    if (command === "workflow_open") return { sessionId, record: saved };
    if (request.operation === "cancel") return null;
    if (request.operation === "close") return { released: !saved.active };
    if (request.operation === "commit") {
      saved = transitionWorkflow(saved, request.action);
      if (request.action.kind === "complete")
        return new Promise((resolve) => {
          acknowledge = resolve;
        });
    }
    return saved;
  });
  const ctl = new AbortController(),
    handle = await studioWorkflowPorts().open(
      { definition: initial.definition, initial: null },
      ctl.signal,
    );
  await handle.store.commit(handle.taskId, { kind: "begin", revision: 1 });
  const done = handle.store.commit(handle.taskId, {
    kind: "complete",
    revision: 2,
    state: "saved",
  });
  ctl.abort();
  await expect(handle.store.read(handle.taskId)).rejects.toThrow(
    "BLK-WORKFLOW-CANCELLED",
  );
  const closing = handle.close();
  expect(
    io.invoke.mock.calls.some((c) => c[1].request.operation === "close"),
  ).toBe(false);
  acknowledge(saved);
  expect((await done).state).toBe("saved");
  await closing;
  expect(io.invoke.mock.calls.at(-1)![1].request.operation).toBe("close");
});
it("closes and rejects a record for a different definition", async () => {
  io.invoke
    .mockResolvedValueOnce({
      sessionId,
      record: {
        ...initial,
        definition: { ...initial.definition, projectId: "other" },
      },
    })
    .mockResolvedValueOnce({ released: true });
  await expect(
    studioWorkflowPorts().open(
      { definition: initial.definition, initial: null },
      new AbortController().signal,
    ),
  ).rejects.toThrow("BLK-WORKFLOW-BINDING");
  expect(io.invoke.mock.calls.at(-1)![1].request.operation).toBe("close");
});
