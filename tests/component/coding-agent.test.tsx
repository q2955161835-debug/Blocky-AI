// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  ProjectController,
  projectDigest,
} from "../../packages/project-model/src";
import { createStarter } from "../../packages/test-fixtures/src";
import type { Studio } from "../../apps/studio-desktop/src/composition/useStudio";
import { useCodingAgent } from "../../apps/studio-desktop/src/composition/useCodingAgent";
import { codingContext } from "../../apps/studio-desktop/src/composition/useCodingChat";
import { useCodingChat } from "../../apps/studio-desktop/src/composition/useCodingChat";
import { codingConversationSchema } from "../../packages/builder-protocol/src";
const native = vi.hoisted(() => vi.fn());
const persisted = new Map<string, unknown>();
it("budgets the formatted status prefixes in long saved conversations", () => {
  const messages = Array.from({ length: 5 }, (_, index) => ({
    id: `message-${index}`,
    role: "assistant" as const,
    text: "a".repeat(12800),
    status: "failed" as const,
  }));
  const context = codingContext(messages);
  expect(() => codingConversationSchema.parse(context)).not.toThrow();
  expect(context.at(-1)?.text).toContain("[failed]");
});
it("keeps persisted ASCII chat within the native 64000 character budget", async () => {
  native.mockImplementation(async (name, args) => storage(name, args));
  const hook = renderHook(() => useCodingChat("sample", vi.fn()));
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  act(() =>
    hook.result.current.update("sample", () =>
      Array.from({ length: 6 }, (_, index) => ({
        id: `message-${index}`,
        role: "assistant",
        text: "a".repeat(16000),
        status: "completed",
      })),
    ),
  );
  await act(() => hook.result.current.flush());
  expect(
    hook.result.current.messages.reduce(
      (sum, message) => sum + message.text.length,
      0,
    ),
  ).toBeLessThanOrEqual(64000);
});
beforeEach(() => {
  vi.stubGlobal("isTauri", true);
  (window as any).__TAURI_INTERNALS__ = {
    invoke: native,
    transformCallback: () => 1,
  };
});
afterEach(() => {
  cleanup();
  native.mockReset();
  persisted.clear();
  delete (window as any).__TAURI_INTERNALS__;
  vi.unstubAllGlobals();
});
function studio(id = "research-workbench") {
  const p = createStarter();
  p.manifest.projectId = id;
  const controller = new ProjectController(p);
  return {
    controller,
    snapshot: controller.getSnapshot(),
    session: { active: "research-agent" },
    selectedRoots: [],
    selected: null,
    resources: { map: new Map(), flush: async () => {} },
    setMessage: vi.fn(),
  } as unknown as Studio;
}
function storage(name: string, args: any) {
  const key = `${args.kind}/${args.id}`;
  if (name === "read_user_state") return persisted.get(key) ?? null;
  if (name === "write_user_state")
    persisted.set(key, structuredClone(args.value));
}
async function result(start: any, project?: unknown) {
  return {
    schemaVersion: "blocky.coding-result/v1",
    requestId: start.requestId,
    projectId: start.projectId,
    baseDigest: await projectDigest(JSON.parse(start.originalJson)),
    text: "已读取项目",
    changes: [],
    events: [],
    generations: [],
    engine: "pi-agent-core/0.86.0",
    modelApiCalled: false,
    ...(project ? { project } : {}),
  };
}
it("sends natural tasks with fresh project context and keeps coding history separate", async () => {
  const s = studio(),
    starts: any[] = [];
  native.mockImplementation(async (name, args) => {
    if (name !== "coding_run") return storage(name, args);
    starts.push(args.start);
    return result(args.start);
  });
  const hook = renderHook(() => useCodingAgent(s));
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  await act(() =>
    hook.result.current.generate({
      prompt: "解释当前代码",
      resourceId: "my-model",
    }),
  );
  act(() =>
    s.controller.edit((p) => {
      p.manifest.displayName = "最新名称";
    }),
  );
  await act(() =>
    hook.result.current.generate({
      prompt: "继续修改",
      resourceId: "my-model",
    }),
  );
  expect(starts[1].conversation.at(-1).text).toBe("已读取项目");
  expect(JSON.parse(starts[1].originalJson).manifest.displayName).toBe(
    "最新名称",
  );
  expect(starts[1].intent).toBeUndefined();
  expect(starts[1].mode).toBeUndefined();
  await act(() => hook.result.current.flush());
  expect(persisted.has("coding-chat/research-workbench")).toBe(true);
  expect(persisted.has("builder-chat/research-workbench")).toBe(false);
});
it("cancels during resource flush without starting a model or writing", async () => {
  const s = studio();
  let release!: () => void;
  s.resources.flush = () =>
    new Promise((resolve) => {
      release = resolve;
    });
  native.mockImplementation(async (name, args) => storage(name, args));
  const hook = renderHook(() => useCodingAgent(s));
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  let pending!: Promise<void>;
  act(() => {
    pending = hook.result.current.generate({
      prompt: "修改文件",
      resourceId: "my-model",
    });
  });
  act(() => hook.result.current.stop());
  expect(hook.result.current.busy).toBe(true);
  await act(async () => {
    release();
    await pending;
  });
  expect(native.mock.calls.some(([name]) => name === "coding_run")).toBe(false);
  expect(hook.result.current.messages.at(-1)?.status).toBe("cancelled");
});
it("ignores cross-project stream and late completion, preserving independent conversations", async () => {
  const a = studio(),
    b = studio("other-project");
  let release!: () => void, started!: () => void;
  const began = new Promise<void>((resolve) => {
    started = resolve;
  });
  native.mockImplementation(async (name, args) => {
    if (name !== "coding_run") return storage(name, args);
    started();
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    args.onEvent.onmessage({
      schemaVersion: "blocky.coding-event/v1",
      requestId: args.start.requestId,
      projectId: args.start.projectId,
      sequence: 1,
      kind: "text.delta",
      text: "旧回复",
    });
    return result(args.start);
  });
  const hook = renderHook(({ s }) => useCodingAgent(s), {
    initialProps: { s: a },
  });
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  let pending!: Promise<void>;
  await act(async () => {
    pending = hook.result.current.generate({
      prompt: "检查",
      resourceId: "my-model",
    });
    await began;
  });
  hook.rerender({ s: b });
  await act(async () => {
    release();
    await pending;
  });
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  expect(hook.result.current.messages).toEqual([]);
  expect(hook.result.current.liveText).toBe("");
  expect(hook.result.current.result).toBeUndefined();
  expect(
    native.mock.calls.filter(([name]) => name === "coding_cancel"),
  ).toHaveLength(1);
});
it("applies a verified project candidate as one undoable edit and rejects stale canvas", async () => {
  const s = studio();
  native.mockImplementation(async (name, args) => {
    if (name === "coding_validate_project") return args.project;
    if (name !== "coding_run") return storage(name, args);
    const p = JSON.parse(args.start.originalJson);
    p.manifest.displayName = "改进后的项目";
    return result(args.start, p);
  });
  const hook = renderHook(() => useCodingAgent(s));
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  const before = s.controller.getSnapshot().project.manifest.displayName;
  await act(() =>
    hook.result.current.generate({
      prompt: "修改名称",
      resourceId: "my-model",
    }),
  );
  expect(s.controller.getSnapshot().project.manifest.displayName).toBe(before);
  await act(() => hook.result.current.applyProject([]));
  expect(s.controller.getSnapshot().project.manifest.displayName).toBe(
    "改进后的项目",
  );
  act(() => s.controller.undo());
  expect(s.controller.getSnapshot().project.manifest.displayName).toBe(before);
  await act(() =>
    hook.result.current.generate({ prompt: "再修改", resourceId: "my-model" }),
  );
  act(() =>
    s.controller.edit((p) => {
      p.manifest.displayName = "用户新修改";
    }),
  );
  await act(() => hook.result.current.applyProject([]));
  expect(s.controller.getSnapshot().project.manifest.displayName).toBe(
    "用户新修改",
  );
  expect(hook.result.current.error).toBe("BLK-PATCH-001");
});
it("recovers actual Host changes after a failed task and offers version checked undo", async () => {
  const s = studio();
  const change = {
    changeId: "change-1",
    path: "src/new.ts",
    before: null,
    after: "new",
    beforeDigest: null,
    afterDigest: "a".repeat(64),
  };
  native.mockImplementation(async (name, args) => {
    if (name === "coding_workspace_pick")
      return { workspaceId: "workspace-1", displayName: "source" };
    if (name === "coding_run") throw Error("BLK-CODING-TIMEOUT");
    if (name === "coding_changes") return [change];
    if (name === "coding_undo")
      return {
        ...change,
        changeId: "undo-1",
        before: change.after,
        after: null,
        beforeDigest: change.afterDigest,
        afterDigest: null,
      };
    return storage(name, args);
  });
  const hook = renderHook(() => useCodingAgent(s));
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  await act(() => hook.result.current.pickWorkspace());
  await act(() =>
    hook.result.current.generate({
      prompt: "添加文件",
      resourceId: "my-model",
    }),
  );
  expect(hook.result.current.error).toBe("BLK-CODING-TIMEOUT");
  expect(hook.result.current.changes[0]?.change).toEqual(change);
  await act(() => hook.result.current.undoChange(change.changeId));
  expect(hook.result.current.changes[0].undone).toBe(true);
  expect(
    native.mock.calls.find(([name]) => name === "coding_undo")?.[1],
  ).toEqual({ workspaceId: "workspace-1", changeId: "change-1" });
});

it("shows an Agent undo receipt as the active inverse, marking the original withdrawn", async () => {
  const s = studio();
  const original = {
    changeId: "change-1",
    path: "src/new.ts",
    before: null,
    after: "new",
    beforeDigest: null,
    afterDigest: "a".repeat(64),
  };
  const inverse = {
    changeId: "undo-1",
    revertsChangeId: "change-1",
    path: original.path,
    before: "new",
    after: null,
    beforeDigest: original.afterDigest,
    afterDigest: null,
  };
  native.mockImplementation(async (name, args) => {
    if (name === "coding_workspace_pick")
      return { workspaceId: "workspace-1", displayName: "source" };
    if (name === "coding_run")
      return { ...(await result(args.start)), changes: [original, inverse] };
    return storage(name, args);
  });
  const hook = renderHook(() => useCodingAgent(s));
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  await act(() => hook.result.current.pickWorkspace());
  await act(() =>
    hook.result.current.generate({
      prompt: "修改后撤销",
      resourceId: "my-model",
    }),
  );
  expect(hook.result.current.error).toBe("");
  expect(
    hook.result.current.changes.map((receipt) => [
      receipt.change.changeId,
      receipt.undone,
    ]),
  ).toEqual([
    ["change-1", true],
    ["undo-1", false],
  ]);
});

it("recovers partial failed manual undo and disables the invalidated original receipt", async () => {
  const s = studio();
  const original = {
    changeId: "change-1",
    path: "src/file.ts",
    before: "old",
    after: "new",
    beforeDigest: "b".repeat(64),
    afterDigest: "a".repeat(64),
  };
  const partial = {
    changeId: "recovery-1",
    invalidatesChangeId: "change-1",
    path: original.path,
    before: "new",
    after: null,
    beforeDigest: original.afterDigest,
    afterDigest: null,
  };
  native.mockImplementation(async (name, args) => {
    if (name === "coding_workspace_pick")
      return { workspaceId: "workspace-1", displayName: "source" };
    if (name === "coding_run")
      return { ...(await result(args.start)), changes: [original] };
    if (name === "coding_undo") throw Error("BLK-CODING-CONFLICT");
    if (name === "coding_changes") return [original, partial];
    return storage(name, args);
  });
  const hook = renderHook(() => useCodingAgent(s));
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  await act(() => hook.result.current.pickWorkspace());
  await act(() =>
    hook.result.current.generate({ prompt: "修改", resourceId: "my-model" }),
  );
  await act(() => hook.result.current.undoChange(original.changeId));
  expect(hook.result.current.error).toBe("BLK-CODING-CONFLICT");
  expect(hook.result.current.changes[0]).toMatchObject({
    undone: false,
    invalidated: true,
  });
  expect(hook.result.current.changes[1]?.change).toEqual(partial);
});

it("does not place a late manual-undo error into another project's conversation", async () => {
  const a = studio(),
    b = studio("other-project");
  let release!: () => void;
  const change = {
    changeId: "change-1",
    path: "src/new.ts",
    before: null,
    after: "new",
    beforeDigest: null,
    afterDigest: "a".repeat(64),
  };
  native.mockImplementation(async (name, args) => {
    if (name === "coding_workspace_pick")
      return { workspaceId: "workspace-1", displayName: "source" };
    if (name === "coding_run")
      return { ...(await result(args.start)), changes: [change] };
    if (name === "coding_undo") {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      throw Error("BLK-CODING-CONFLICT");
    }
    if (name === "coding_changes") return [change];
    return storage(name, args);
  });
  const hook = renderHook(({ s }) => useCodingAgent(s), {
    initialProps: { s: a },
  });
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  await act(() => hook.result.current.pickWorkspace());
  await act(() =>
    hook.result.current.generate({ prompt: "创建", resourceId: "my-model" }),
  );
  let pending!: Promise<void>;
  act(() => {
    pending = hook.result.current.undoChange(change.changeId);
  });
  hook.rerender({ s: b });
  await act(async () => {
    release();
    await pending;
  });
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  expect(hook.result.current.error).toBe("");
  expect(hook.result.current.changes).toEqual([]);
});
