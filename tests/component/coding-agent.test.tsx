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
const pickedWorkspaces = new Map<
  string,
  { workspaceId: string; displayName: string }
>();
it("keeps complete long status-prefixed messages within the conversation byte budget", () => {
  const messages = Array.from({ length: 5 }, (_, index) => ({
    id: `message-${index}`,
    role: "assistant" as const,
    text: "😀".repeat(20000),
    status: "failed" as const,
  }));
  const context = codingContext(messages);
  expect(() => codingConversationSchema.parse(context)).not.toThrow();
  expect(context).toHaveLength(messages.length);
  expect(
    context.every(
      (message, index) =>
        message.role === messages[index].role &&
        message.text === `[failed] ${messages[index].text}`,
    ),
  ).toBe(true);
});
it("keeps the newest complete messages under the 4 MiB persisted history budget", async () => {
  native.mockImplementation(async (name, args) => storage(name, args));
  const hook = renderHook(() => useCodingChat("sample", vi.fn()));
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  const messages = Array.from({ length: 3 }, (_, index) => ({
    id: `message-${index}`,
    role: "assistant" as const,
    text: "😀".repeat(400000),
    status: "completed" as const,
  }));
  act(() => hook.result.current.update("sample", () => messages));
  await act(() => hook.result.current.flush());
  const retained = messages.slice(-2);
  expect(hook.result.current.messages).toHaveLength(retained.length);
  expect(
    hook.result.current.messages.every(
      (message, index) => message.text === retained[index].text,
    ),
  ).toBe(true);
  const saved = persisted.get("coding-chat/sample") as {
    messages: typeof messages;
  };
  expect(
    new TextEncoder().encode(JSON.stringify(saved.messages)).length,
  ).toBeLessThanOrEqual(4 * 1024 * 1024);
  hook.unmount();
  const reopened = renderHook(() => useCodingChat("sample", vi.fn()));
  await waitFor(() => expect(reopened.result.current.ready).toBe(true));
  expect(reopened.result.current.messages).toHaveLength(retained.length);
  expect(
    reopened.result.current.messages.every(
      (message, index) => message.text === retained[index].text,
    ),
  ).toBe(true);
});
it("bounds coding request history by bytes while retaining newest complete messages", () => {
  const messages = [
    {
      id: "context-old",
      role: "assistant" as const,
      text: "older context",
      status: "completed" as const,
    },
    ...Array.from({ length: 3 }, (_, index) => ({
      id: `context-${index}`,
      role: "assistant" as const,
      text: "😀".repeat(400000),
      status: "completed" as const,
    })),
  ];
  const context = codingContext(messages);
  const retained = messages.slice(-2);
  expect(context).toHaveLength(retained.length);
  expect(
    context.every((message, index) => message.text === retained[index].text),
  ).toBe(true);
  expect(
    new TextEncoder().encode(JSON.stringify(context)).length,
  ).toBeLessThanOrEqual(4 * 1024 * 1024);
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
  pickedWorkspaces.clear();
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
    diagnostics: [],
    events: [],
    setMessage: vi.fn(),
  } as unknown as Studio;
}
function storage(name: string, args: any) {
  if (name === "workspace_status") {
    const workspace = pickedWorkspaces.get(args.projectId);
    return {
      available: !!workspace,
      workspaceId: workspace?.workspaceId ?? null,
      displayName: workspace?.displayName ?? null,
      changes: [],
    };
  }
  const key = `${args.kind}/${args.id}`;
  if (name === "read_user_state") return persisted.get(key) ?? null;
  if (name === "write_user_state")
    persisted.set(key, structuredClone(args.value));
}
function pickWorkspace(args: any) {
  expect(typeof args.projectId).toBe("string");
  const workspace = { workspaceId: "workspace-1", displayName: "source" };
  pickedWorkspaces.set(args.projectId, workspace);
  return workspace;
}
it.each(["cancelled", "failed"] as const)(
  "retains partial reply after %s and reopening, with the next turn kept separate",
  async (outcome) => {
    const s = studio();
    let rejectRun!: (error: Error) => void;
    let started = false;
    let count = 0;
    let lateEvent!: () => void;
    native.mockImplementation(async (name, args) => {
      if (name !== "coding_run") return storage(name, args);
      if (++count > 1) return result(args.start);
      const base = {
        schemaVersion: "blocky.coding-event/v1",
        requestId: args.start.requestId,
        projectId: args.start.projectId,
      };
      args.onEvent.onmessage({
        ...base,
        sequence: 1,
        kind: "text.delta",
        text: "已经分析出的部分答案",
      });
      args.onEvent.onmessage({
        ...base,
        sequence: 2,
        kind: "thinking.delta",
        text: "先检查依赖关系",
      });
      args.onEvent.onmessage({
        ...base,
        sequence: 3,
        kind: "tool.started",
        tool: "blocky_cli",
        callId: "cli-1",
        command: "blocky project validate",
      });
      args.onEvent.onmessage({
        ...base,
        sequence: 4,
        kind: "tool.completed",
        tool: "blocky_cli",
        callId: "cli-1",
        exitCode: 0,
      });
      args.onEvent.onmessage({
        ...base,
        sequence: 5,
        kind: "tool.failed",
        tool: "blocky_cli",
        callId: "cli-failed",
        command: "blocky project compile",
        exitCode: 1,
        code: "BLK-CODING-CHECK",
      });
      args.onEvent.onmessage({
        ...base,
        sequence: 6,
        kind: "tool.started",
        tool: "workspace_list",
        callId: "list-1",
      });
      lateEvent = () =>
        args.onEvent.onmessage({
          ...base,
          sequence: 7,
          kind: "tool.completed",
          tool: "workspace_list",
          callId: "list-1",
        });
      started = true;
      return new Promise((_, reject) => {
        rejectRun = reject;
      });
    });
    const hook = renderHook(() => useCodingAgent(s));
    await waitFor(() => expect(hook.result.current.ready).toBe(true));
    let pending!: Promise<void>;
    act(() => {
      pending = hook.result.current.generate({
        prompt: "分析",
        resourceId: "my-model",
      });
    });
    await waitFor(() => expect(started).toBe(true));
    if (outcome === "cancelled") act(() => hook.result.current.stop());
    if (outcome === "cancelled") act(lateEvent);
    await act(async () => {
      rejectRun(
        Error(
          outcome === "cancelled"
            ? "BLK-CODING-CANCELLED"
            : "BLK-CODING-ENGINE",
        ),
      );
      await pending;
      await hook.result.current.flush();
    });
    expect(hook.result.current.messages.at(-1)?.text).toContain(
      "已经分析出的部分答案",
    );
    expect(hook.result.current.messages.at(-1)?.status).toBe(outcome);
    expect(hook.result.current.messages.at(-1)?.thinking).toBe(
      "先检查依赖关系",
    );
    expect(hook.result.current.messages.at(-1)?.activity).toEqual([
      {
        callId: "cli-1",
        tool: "blocky_cli",
        status: "completed",
        command: "blocky project validate",
        exitCode: 0,
      },
      {
        callId: "cli-failed",
        tool: "blocky_cli",
        status: "failed",
        command: "blocky project compile",
        exitCode: 1,
        code: "BLK-CODING-CHECK",
      },
      {
        callId: "list-1",
        tool: "workspace_list",
        status: outcome === "cancelled" ? "cancelled" : "failed",
      },
    ]);
    act(lateEvent);
    expect(
      hook.result.current.messages.filter(
        (message) => message.role === "assistant",
      ),
    ).toHaveLength(1);
    expect(hook.result.current.messages.at(-1)?.status).toBe(outcome);
    const legacy = persisted.get("coding-chat/research-workbench") as {
      messages: Record<string, unknown>[];
    };
    expect(legacy.messages.at(-1)).not.toHaveProperty("thinking");
    expect(legacy.messages.at(-1)).not.toHaveProperty("activity");
    hook.unmount();
    const reopened = renderHook(() => useCodingAgent(s));
    await waitFor(() => expect(reopened.result.current.ready).toBe(true));
    expect(reopened.result.current.messages.at(-1)?.text).toContain(
      "已经分析出的部分答案",
    );
    expect(reopened.result.current.messages.at(-1)?.thinking).toBe(
      "先检查依赖关系",
    );
    expect(
      reopened.result.current.messages.at(-1)?.activity?.[0].exitCode,
    ).toBe(0);
    expect(reopened.result.current.messages.at(-1)?.activity?.[1]).toEqual({
      callId: "cli-failed",
      tool: "blocky_cli",
      status: "failed",
      command: "blocky project compile",
      exitCode: 1,
      code: "BLK-CODING-CHECK",
    });
    await act(() =>
      reopened.result.current.generate({
        prompt: "下一轮",
        resourceId: "my-model",
      }),
    );
    expect(
      reopened.result.current.messages.filter((message) =>
        message.text.includes("已经分析出的部分答案"),
      ),
    ).toHaveLength(1);
    expect(reopened.result.current.messages.at(-1)?.text).toBe("已读取项目");
    expect(reopened.result.current.messages.at(-1)?.activity).toBeUndefined();
    expect(reopened.result.current.messages.at(-1)?.thinking).toBeUndefined();
  },
);
it("ignores an old successful callback while the next turn is active", async () => {
  const s = studio();
  let turn = 0;
  let sendOld!: () => void;
  let completeSecond!: () => Promise<void>;
  native.mockImplementation(async (name, args) => {
    if (name !== "coding_run") return storage(name, args);
    const base = {
      schemaVersion: "blocky.coding-event/v1",
      requestId: args.start.requestId,
      projectId: args.start.projectId,
    };
    if (++turn === 1) {
      args.onEvent.onmessage({
        ...base,
        sequence: 1,
        kind: "text.delta",
        text: "第一轮正文",
      });
      sendOld = () => {
        args.onEvent.onmessage({
          ...base,
          sequence: 2,
          kind: "text.delta",
          text: "旧轮晚到正文",
        });
        args.onEvent.onmessage({
          ...base,
          sequence: 3,
          kind: "thinking.delta",
          text: "旧轮晚到思考",
        });
        args.onEvent.onmessage({
          ...base,
          sequence: 4,
          kind: "tool.started",
          tool: "blocky_cli",
          callId: "old-cli",
          command: "blocky project compile",
        });
        args.onEvent.onmessage({
          ...base,
          sequence: 5,
          kind: "tool.completed",
          tool: "blocky_cli",
          callId: "old-cli",
          exitCode: 0,
        });
      };
      return { ...(await result(args.start)), text: "第一轮完整正文" };
    }
    const secondEvents = [
      { ...base, sequence: 1, kind: "text.delta", text: "新轮部分正文" },
      { ...base, sequence: 2, kind: "thinking.delta", text: "新轮思考" },
      {
        ...base,
        sequence: 3,
        kind: "tool.started",
        tool: "workspace_list",
        callId: "new-list",
      },
      {
        ...base,
        sequence: 4,
        kind: "tool.completed",
        tool: "workspace_list",
        callId: "new-list",
      },
    ];
    for (const event of secondEvents) args.onEvent.onmessage(event);
    return new Promise((resolve) => {
      completeSecond = async () =>
        resolve({
          ...(await result(args.start)),
          text: "新轮完整正文",
          events: secondEvents,
        });
    });
  });
  const hook = renderHook(() => useCodingAgent(s));
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  await act(() =>
    hook.result.current.generate({ prompt: "第一轮", resourceId: "my-model" }),
  );
  let next!: Promise<void>;
  act(() => {
    next = hook.result.current.generate({
      prompt: "第二轮",
      resourceId: "my-model",
    });
  });
  await waitFor(() =>
    expect(hook.result.current.liveText).toBe("新轮部分正文"),
  );
  expect(hook.result.current.busy).toBe(true);
  const activity = structuredClone(hook.result.current.liveActivity);
  const messages = structuredClone(hook.result.current.messages);
  act(sendOld);
  expect(hook.result.current.liveText).toBe("新轮部分正文");
  expect(hook.result.current.liveThinking).toBe("新轮思考");
  expect(hook.result.current.liveActivity).toEqual(activity);
  expect(hook.result.current.messages).toEqual(messages);
  expect(hook.result.current.stopping).toBe(false);
  expect(hook.result.current.error).toBe("");
  await act(async () => {
    await completeSecond();
    await next;
    await hook.result.current.flush();
  });
  expect(hook.result.current.messages.at(-1)).toMatchObject({
    text: "新轮完整正文",
    thinking: "新轮思考",
    activity: [
      { callId: "new-list", tool: "workspace_list", status: "completed" },
    ],
  });
  expect(JSON.stringify(hook.result.current.messages)).not.toContain(
    "旧轮晚到",
  );
  expect(JSON.stringify(hook.result.current.messages)).not.toContain("old-cli");
});
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
  await waitFor(() => expect(release).toBeTypeOf("function"));
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
it("automatically applies a verified project candidate and retains it on a canvas conflict", async () => {
  const s = studio();
  s.diagnostics = [
    {
      code: "BLK-LINK-001",
      severity: "error",
      source: {
        projectId: "research-workbench",
        moduleId: "research-agent",
        blockId: "research-root",
      },
    },
  ] as unknown as Studio["diagnostics"];
  s.events = [
    {
      projectId: "research-workbench",
      type: "run.failed",
      moduleId: "research-agent",
      blockId: "research-root",
      data: { code: "BLK-RUN-009", message: "sensitive response" },
    },
    {
      projectId: "other-project",
      type: "run.failed",
      data: { code: "BLK-RUN-010" },
    },
  ] as unknown as Studio["events"];
  let conflictOnValidation = false;
  native.mockImplementation(async (name, args) => {
    if (name === "coding_validate_project") {
      expect(args.approved).toEqual([]);
      if (conflictOnValidation) {
        conflictOnValidation = false;
        s.controller.edit((p) => {
          p.manifest.displayName = "用户新修改";
        });
      }
      return args.project;
    }
    if (name !== "coding_run") return storage(name, args);
    expect(args.start.runtimeContext).toEqual({
      diagnostics: [
        {
          code: "BLK-LINK-001",
          severity: "error",
          moduleId: "research-agent",
          blockId: "research-root",
        },
      ],
      recentEvents: [
        {
          type: "run.failed",
          moduleId: "research-agent",
          blockId: "research-root",
          code: "BLK-RUN-009",
        },
      ],
    });
    expect(JSON.stringify(args.start.runtimeContext)).not.toContain(
      "sensitive response",
    );
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
  expect(s.controller.getSnapshot().project.manifest.displayName).toBe(
    "改进后的项目",
  );
  expect(hook.result.current.projectReview?.status).toBe("applied");
  act(() => s.controller.undo());
  expect(s.controller.getSnapshot().project.manifest.displayName).toBe(before);
  conflictOnValidation = true;
  await act(() =>
    hook.result.current.generate({ prompt: "再修改", resourceId: "my-model" }),
  );
  expect(s.controller.getSnapshot().project.manifest.displayName).toBe(
    "用户新修改",
  );
  expect(hook.result.current.projectReview?.status).toBe("conflict");
  expect(hook.result.current.result?.project?.manifest.displayName).toBe(
    "改进后的项目",
  );
  expect(hook.result.current.error).toBe("BLK-PATCH-001");
});
it("recovers Host changes after a failed task and keeps manual undo reversible", async () => {
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
    if (name === "coding_workspace_pick") return pickWorkspace(args);
    if (name === "coding_run") throw Error("BLK-CODING-TIMEOUT");
    if (name === "coding_changes") return [change];
    if (name === "coding_undo" && args.changeId === "undo-1")
      return { ...change, changeId: "redo-1", revertsChangeId: "undo-1" };
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
  expect(
    hook.result.current.changes.find(
      (item) => item.change.changeId === "undo-1",
    ),
  ).toMatchObject({ undone: false, invalidated: false });
  await act(() => hook.result.current.undoChange("undo-1"));
  expect(hook.result.current.error).toBe("");
  expect(
    hook.result.current.changes.map((item) => [
      item.change.changeId,
      item.undone,
    ]),
  ).toEqual([
    ["change-1", true],
    ["undo-1", true],
    ["redo-1", false],
  ]);
  expect(
    native.mock.calls.filter(([name]) => name === "coding_undo").at(-1)?.[1],
  ).toEqual({ workspaceId: "workspace-1", changeId: "undo-1" });
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
    if (name === "coding_workspace_pick") return pickWorkspace(args);
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
    if (name === "coding_workspace_pick") return pickWorkspace(args);
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
    if (name === "coding_workspace_pick") return pickWorkspace(args);
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

it("streams, saves, reloads, and reuses a complete response above 64 KiB", async () => {
  const context = codingContext([
    {
      id: "message-1",
      role: "assistant",
      status: "completed",
      text: "😀".repeat(20000),
    },
  ]);
  expect(context[0].text === "😀".repeat(20000)).toBe(true);
  const s = studio();
  const responseText = "😀".repeat(36000);
  const chunks = Array.from({ length: 5 }, (_, index) =>
    responseText.slice(index * 16000, (index + 1) * 16000),
  );
  let codingRun = 0;
  let start!: () => void;
  let release!: (value: unknown) => void;
  const runStarted = new Promise<void>((resolve) => (start = resolve));
  const resultPending = new Promise<unknown>((resolve) => (release = resolve));
  const starts: any[] = [];
  native.mockImplementation(async (name, args) => {
    if (name !== "coding_run") return storage(name, args);
    starts.push(args.start);
    if (codingRun++ === 0) {
      start();
      for (const [index, text] of chunks.entries()) {
        args.onEvent.onmessage({
          schemaVersion: "blocky.coding-event/v1",
          requestId: args.start.requestId,
          projectId: args.start.projectId,
          sequence: index + 1,
          kind: "text.delta",
          text,
        });
      }
      return resultPending;
    }
    return { ...(await result(args.start)), text: "已继续完成。" };
  });
  const hook = renderHook(() => useCodingAgent(s));
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  let pending!: Promise<void>;
  await act(() => {
    pending = hook.result.current.generate({
      prompt: "解释",
      resourceId: "my-model",
    });
    return runStarted;
  });
  const liveAtEndOfStream = hook.result.current.liveText;
  await act(async () => {
    release({
      ...(await result(starts[0])),
      text: responseText,
      events: chunks.map((text, index) => ({
        schemaVersion: "blocky.coding-event/v1",
        requestId: starts[0].requestId,
        projectId: starts[0].projectId,
        sequence: index + 1,
        kind: "text.delta",
        text,
      })),
    });
    await pending;
  });
  expect(liveAtEndOfStream === responseText).toBe(true);
  expect(hook.result.current.messages.at(-1)?.text === responseText).toBe(true);
  await act(() => hook.result.current.flush());
  hook.unmount();
  const reopened = renderHook(() => useCodingAgent(s));
  await waitFor(() => expect(reopened.result.current.ready).toBe(true));
  expect(reopened.result.current.messages.at(-1)?.text === responseText).toBe(
    true,
  );
  await act(() =>
    reopened.result.current.generate({
      prompt: "继续",
      resourceId: "my-model",
    }),
  );
  expect(starts.at(-1).conversation.at(-1).text === responseText).toBe(true);
  expect(reopened.result.current.messages.at(-1)?.text).toBe("已继续完成。");
});
