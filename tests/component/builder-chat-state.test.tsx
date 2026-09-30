// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ProjectController } from "../../packages/project-model/src";
import { createStarter } from "../../packages/test-fixtures/src";
import {
  createBuilderSession,
  builderInputBudget,
} from "../../packages/builder-protocol/src";
import { useBuilderChat } from "../../apps/studio-desktop/src/composition/useBuilderChat";
import { useBuilder } from "../../apps/studio-desktop/src/composition/useBuilder";
import type { Studio } from "../../apps/studio-desktop/src/composition/useStudio";
const native = vi.hoisted(() => vi.fn());
const stored = new Map<string, unknown>();
beforeEach(() => {
  (window as any).__TAURI_INTERNALS__ = { invoke: native };
});
afterEach(() => {
  cleanup();
  native.mockReset();
  stored.clear();
  localStorage.clear();
  delete (window as any).__TAURI_INTERNALS__;
});
function studio(id = "research-workbench") {
  const project = createStarter();
  project.manifest.projectId = id;
  const controller = new ProjectController(project);
  return {
    controller,
    snapshot: controller.getSnapshot(),
    session: { active: "research-agent" },
    selected: null,
    selectedRoots: [],
    resources: { map: new Map(), flush: async () => {} },
    setMessage: vi.fn(),
  } as unknown as Studio;
}
const input = {
  intent: "explain",
  prompt: "记住我们正在搭建植物课堂",
  createSurface: false,
  mode: "deterministic",
  resourceId: "",
} as const;
async function proposal(s: Studio, request: unknown, patch = false) {
  const session = await createBuilderSession(
    s.controller.getSnapshot().project,
    request,
  );
  session.draft({
    plan: ["说明当前角色"],
    acceptanceCriteria: ["角色来自当前项目"],
    explanation: "当前是植物课堂助手",
  });
  if (patch) {
    await session.patch({
      operations: [
        {
          op: "block.update",
          moduleId: "research-agent",
          blockId: "research-root",
          payload: { fields: { ROLE: "植物课堂" } },
        },
      ],
    });
    await session.verify();
  }
  return {
    ...session.result(),
    modelApiCalled: false,
    engine: "test",
    generations: [],
  };
}
function persistence(name: string, args: any) {
  const key = `${args.kind}/${args.id}`;
  if (name === "read_user_state") return stored.get(key) ?? null;
  if (name === "write_user_state") {
    stored.set(key, structuredClone(args.value));
    return;
  }
}
it("keeps saved Unicode history within the native byte budget", async () => {
  native.mockImplementation(async (name, args) => persistence(name, args));
  const hook = renderHook(() => useBuilderChat("unicode-chat", vi.fn()));
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  act(() =>
    hook.result.current.update("unicode-chat", () =>
      Array.from({ length: 40 }, (_, index) => ({
        id: `message-${index}`,
        role: "assistant",
        text: "字".repeat(4000),
        status: "proposed",
      })),
    ),
  );
  await act(() => hook.result.current.flush());
  expect(hook.result.current.messages.length).toBeLessThan(40);
  expect(() =>
    builderInputBudget(stored.get("builder-chat/unicode-chat")),
  ).not.toThrow();
  hook.unmount();
  const reopened = renderHook(() => useBuilderChat("unicode-chat", vi.fn()));
  await waitFor(() => expect(reopened.result.current.ready).toBe(true));
  expect(
    reopened.result.current.messages.every(
      (message) => message.status === "stale",
    ),
  ).toBe(true);
});
it("sends prior accepted and rejected messages with the current project and retains history across selection changes", async () => {
  const s = studio(),
    starts: any[] = [];
  native.mockImplementation(async (name, args) => {
    if (name !== "builder_run") return persistence(name, args);
    starts.push(args.start);
    return proposal(
      s,
      args.start.request,
      args.start.request.intent === "build",
    );
  });
  const hook = renderHook(() => useBuilder(s));
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  await act(() => hook.result.current.generate({ ...input, intent: "build" }));
  const first = hook.result.current.result!;
  act(() => {
    s.controller.edit((p) => {
      p.manifest.displayName = "最新课堂";
    });
    hook.result.current.markApplied(first.patch!.patchId);
  });
  s.selected = "research-root";
  hook.rerender();
  expect(hook.result.current.messages).toHaveLength(2);
  await act(() =>
    hook.result.current.generate({
      ...input,
      intent: "build",
      prompt: "再优化刚才的方案",
    }),
  );
  expect(starts[1].request.conversation.at(-1).status).toBe("accepted");
  expect(JSON.parse(starts[1].originalJson).manifest.displayName).toBe(
    "最新课堂",
  );
  act(() => hook.result.current.reject());
  await act(() => hook.result.current.generate(input));
  expect(starts[2].request.conversation.at(-1).status).toBe("rejected");
  await act(() => hook.result.current.flush());
  hook.unmount();
  const reopened = renderHook(() => useBuilder(s));
  await waitFor(() => expect(reopened.result.current.ready).toBe(true));
  expect(reopened.result.current.messages).toHaveLength(6);
  expect(reopened.result.current.result).toBeUndefined();
  expect(JSON.stringify(s.controller.getSnapshot().project)).not.toContain(
    "builder-chat",
  );
});
it("stops during resource flush without starting a native model request and waits for settlement", async () => {
  const s = studio();
  let release!: () => void;
  s.resources.flush = () =>
    new Promise<void>((resolve) => {
      release = resolve;
    });
  native.mockImplementation(async (name, args) => persistence(name, args));
  const hook = renderHook(() => useBuilder(s));
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  let pending!: Promise<void>;
  act(() => {
    pending = hook.result.current.generate(input);
  });
  act(() => hook.result.current.stop());
  expect(hook.result.current.busy).toBe(true);
  expect(hook.result.current.stopping).toBe(true);
  await act(async () => {
    release();
    await pending;
  });
  expect(native.mock.calls.some(([name]) => name === "builder_run")).toBe(
    false,
  );
  expect(hook.result.current.busy).toBe(false);
  expect(hook.result.current.messages.at(-1)?.status).toBe("cancelled");
});
it("cancels an old project request, drops its late candidate and isolates the next conversation", async () => {
  const a = studio(),
    b = studio("different-project");
  let release!: () => void;
  let started!: () => void;
  const began = new Promise<void>((resolve) => {
    started = resolve;
  });
  native.mockImplementation(async (name, args) => {
    if (name !== "builder_run") return persistence(name, args);
    const value = await proposal(a, args.start.request);
    started();
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return value;
  });
  const hook = renderHook(({ s }) => useBuilder(s), { initialProps: { s: a } });
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  let pending!: Promise<void>;
  await act(async () => {
    pending = hook.result.current.generate(input);
    await began;
  });
  hook.rerender({ s: b });
  expect(hook.result.current.busy).toBe(true);
  await act(async () => {
    release();
    await pending;
  });
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  expect(hook.result.current.result).toBeUndefined();
  expect(hook.result.current.messages).toEqual([]);
  expect(
    native.mock.calls.filter(([name]) => name === "builder_cancel"),
  ).toHaveLength(1);
  hook.rerender({ s: a });
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  expect(hook.result.current.messages.at(-1)?.status).toBe("cancelled");
});
