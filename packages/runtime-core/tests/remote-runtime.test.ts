import { expect, it, vi } from "vitest";
import { RemoteRuntime } from "../src/remote-runtime";
import { RuntimeServiceHost } from "../src/runtime-service-host";
import { localAdapters, Runtime } from "../src";
import { createArchitectureStarter } from "../../block-catalog/src";
import { createStarter } from "../../test-fixtures/src";
import { planToRpaBlocks } from "@blocky/rpa-core";

const request = (project = createStarter(), question = "水循环") => ({
  schemaVersion: "blocky.desktop-run/v1",
  project,
  interactionId: "on-question",
  question,
  options: {},
});
const rpaRequest = () => ({
  plan: {
    schemaVersion: "blocky.rpa/v1",
    planId: "owned",
    target: { kind: "windows", identity: "owned-window" },
    steps: [
      {
        stepId: "read",
        action: "read",
        locator: { kind: "uia", automationId: "answer" },
        timeoutMs: 1000,
      },
    ],
  },
  inputSources: {},
});
it("accepts existing project identifiers and debug selections without narrower transport limits", async () => {
  const interactionId = `entry-${"a".repeat(150)}`;
  const project = JSON.parse(
    JSON.stringify(createStarter()).replaceAll(
      '"on-question"',
      JSON.stringify(interactionId),
    ),
  );
  const debug = {
    breakpoints: Array.from({ length: 1001 }, (_, i) => ({
      moduleId: "research-agent",
      blockId: `unused-${i}`,
    })),
  };
  const expected = await new Runtime().run(project, interactionId, "水循环", {
    debug,
  });
  expect(expected.status).toBe("completed");
  const host = new RuntimeServiceHost(
    project.manifest.projectId,
    localAdapters(),
  );
  const runtime = new RemoteRuntime((v, s) => host.request(v, s));
  const output = await runtime.run(
    { ...request(project), interactionId, options: { debug } },
    new AbortController().signal,
    () => {},
  );
  expect(output.result.status).toBe(expected.status);
  expect(output.result.answer).toBe(expected.answer);
  await host.close();
});
it("runs the same Runtime through a serializable request and retains private state across runs", async () => {
  const project = createArchitectureStarter("state-machine");
  let state: string | undefined;
  for (const [input, expected] of [
    ["start", "running"],
    ["finish", "done"],
  ]) {
    const host = new RuntimeServiceHost(
      project.manifest.projectId,
      localAdapters(),
    );
    const runtime = new RemoteRuntime((value, signal) =>
      host.request(value, signal),
    );
    const output = await runtime.run(
      {
        ...request(project, input),
        interactionId: "on-event",
        ...(state ? { state } : {}),
      },
      new AbortController().signal,
      () => {},
    );
    await host.close();
    expect(output.result.status).toBe("completed");
    expect(output.result.structured).toBe(expected);
    expect(output.result.modelApiCalled).toBe(false);
    expect(Object.keys(output).sort()).toEqual(["result", "state"]);
    state = output.state;
  }
});
it("preserves pause, single step, resume and cancellation at real block boundaries", async () => {
  for (const cancel of [false, true]) {
    const project = createStarter(),
      host = new RuntimeServiceHost(
        project.manifest.projectId,
        localAdapters(),
      );
    const runtime = new RemoteRuntime((value, signal) =>
        host.request(value, signal),
      ),
      abort = new AbortController();
    let paused = 0;
    const output = await runtime.run(
      request(project),
      abort.signal,
      (event) => {
        if (event.type === "run.started") runtime.control("pause");
        if (event.type === "run.paused") {
          paused++;
          if (cancel) abort.abort();
          else runtime.control(paused === 1 ? "step" : "resume");
        }
      },
    );
    expect(paused).toBeGreaterThan(0);
    expect(output.result.status).toBe(cancel ? "cancelled" : "completed");
    await host.close();
  }
});
it("routes only declared services and binds them to the active project", async () => {
  const adapters = localAdapters();
  const memory = vi.fn(async () => "private-memory");
  adapters.agent = { memory };
  const host = new RuntimeServiceHost("project-one", adapters);
  const signal = new AbortController().signal;
  await expect(
    host.request({ service: "invoke", operation: "secret-read" }, signal),
  ).rejects.toThrow("BLK-RUN-SERVICE");
  await expect(
    host.request(
      { service: "agent.memory", input: { projectId: "other-project" } },
      signal,
    ),
  ).rejects.toThrow("BLK-RUN-SERVICE");
  expect(memory).not.toHaveBeenCalled();
  await expect(
    host.request(
      {
        service: "agent.memory",
        input: {
          projectId: "project-one",
          sessionId: "session-one",
          requestId: "request-one",
          key: "note",
          scope: "project",
          action: "read",
        },
      },
      signal,
    ),
  ).resolves.toBe("private-memory");
  expect(memory).toHaveBeenCalledOnce();
  await host.close();
  await expect(
    host.request(
      { service: "agent.memory", input: { projectId: "project-one" } },
      signal,
    ),
  ).rejects.toThrow("BLK-RUN-SERVICE");
});
it("waits for outstanding effects on close and uses one signal for native memory lifecycle", async () => {
  const adapters = localAdapters();
  let release!: () => void, used: AbortSignal | undefined;
  const close = vi.fn(async (signal: AbortSignal) => {
    expect(signal).toBe(used);
  });
  adapters.agent = {
    memory: async (_request, signal) => {
      used = signal;
      await new Promise<void>((resolve) => (release = resolve));
      return null;
    },
    close,
  };
  const host = new RuntimeServiceHost("project-one", adapters),
    abort = new AbortController();
  const pending = host.request(
    {
      service: "agent.memory",
      input: {
        projectId: "project-one",
        sessionId: "session-one",
        requestId: "request-one",
        key: "note",
        scope: "project",
        action: "read",
      },
    },
    abort.signal,
  );
  let finished = false;
  const settled = host.close().then(() => (finished = true));
  await Promise.resolve();
  expect(finished).toBe(false);
  expect(used!.aborted).toBe(true);
  release();
  await pending;
  await settled;
  expect(close).toHaveBeenCalledOnce();
});
it("rejects malformed start data before requesting a Host capability", async () => {
  const call = vi.fn(async () => null),
    runtime = new RemoteRuntime(call);
  for (const value of [
    { ...request(), schemaVersion: "unknown" },
    { ...request(), executable: "arbitrary.exe" },
    { ...request(), options: { capabilities: ["shell"] } },
    { ...request(), state: {} },
  ]) {
    await expect(
      runtime.run(value, new AbortController().signal, () => {}),
    ).rejects.toThrow("BLK-RUN-STATE");
  }
  expect(call).not.toHaveBeenCalled();
});

it("keeps manual RPA bodies private and waits for the approved handle to settle", async () => {
  const project = createArchitectureStarter("rule-engine", "owned-rpa");
  const root = planToRpaBlocks({
    schemaVersion: "blocky.rpa/v1",
    planId: "owned",
    target: { kind: "windows", identity: "owned-window" },
    steps: [
      {
        stepId: "fill",
        action: "fill",
        locator: { kind: "uia", automationId: "answer" },
        timeoutMs: 1000,
        effectKey: "fill",
        value: { kind: "manual-input" },
      },
    ],
  });
  project.workspaces.main.blocks.blocks = [root];
  const adapters = localAdapters();
  let release!: () => void;
  const performed: string[] = [];
  const close = vi.fn(
    () => new Promise<void>((resolve) => (release = resolve)),
  );
  adapters.rpa = {
    manualInput: async () => "PRIVATE_MANUAL_INPUT",
    open: async () => ({
      checkpointId: "checkpoint-owned",
      close,
      perform: async (step, input) => {
        expect(input).toBe("PRIVATE_MANUAL_INPUT");
        performed.push(step.stepId);
        return {};
      },
    }),
  };
  const host = new RuntimeServiceHost(project.manifest.projectId, adapters),
    runtime = new RemoteRuntime((v, s) => host.request(v, s));
  let finished = false;
  const pending = runtime
    .run(
      { ...request(project), interactionId: root.id },
      new AbortController().signal,
      () => {},
    )
    .then((value) => {
      finished = true;
      return value;
    });
  await vi.waitFor(() => expect(release).toBeTypeOf("function"));
  expect(finished).toBe(false);
  release();
  const output = await pending;
  await host.close();
  expect(output.result.status).toBe("completed");
  expect(performed).toEqual([
    root.inputs!.HANDLER.block!.inputs!.STEPS.block!.id,
  ]);
  expect(close).toHaveBeenCalledOnce();
  expect(JSON.stringify(output.result.events)).not.toContain(
    "PRIVATE_MANUAL_INPUT",
  );
  expect(output.state).not.toContain("PRIVATE_MANUAL_INPUT");
});

it("rejects overlapping RPA approvals and new work after agent close", async () => {
  const adapters = localAdapters();
  let release!: () => void;
  const close = vi.fn(async () => {});
  const open = vi.fn(async () => {
    await new Promise<void>((resolve) => (release = resolve));
    return {
      checkpointId: "checkpoint-owned",
      close,
      perform: async () => ({}),
    };
  });
  adapters.rpa = { open };
  adapters.agent = { memory: vi.fn(async () => null), close };
  const host = new RuntimeServiceHost("project-one", adapters),
    signal = new AbortController().signal;
  const pending = host.request(
    { service: "rpa.open", input: rpaRequest() },
    signal,
  );
  await expect(
    host.request({ service: "rpa.open", input: rpaRequest() }, signal),
  ).rejects.toThrow("BLK-RUN-SERVICE");
  release();
  await pending;
  await host.request({ service: "agent.close" }, signal);
  await expect(
    host.request(
      { service: "agent.memory", input: { projectId: "project-one" } },
      signal,
    ),
  ).rejects.toThrow("BLK-RUN-SERVICE");
  expect(open).toHaveBeenCalledOnce();
  await host.close();
});

it("rejects malformed RPA plans and altered steps before invoking native ports", async () => {
  const adapters = localAdapters();
  const perform = vi.fn(async () => ({}));
  const manualInput = vi.fn(async () => "unused");
  const open = vi.fn(async () => ({
    checkpointId: "checkpoint-owned",
    close: async () => {},
    perform,
  }));
  adapters.rpa = { open, manualInput };
  const host = new RuntimeServiceHost("project-one", adapters),
    signal = new AbortController().signal;
  for (const input of [
    { plan: {}, inputSources: {} },
    { ...rpaRequest(), inputSources: { unknown: "manual" } },
    {
      ...rpaRequest(),
      browser: { projectId: "project-one", url: "https://example.test" },
    },
  ])
    await expect(
      host.request({ service: "rpa.open", input }, signal),
    ).rejects.toThrow("BLK-RUN-SERVICE");
  expect(open).not.toHaveBeenCalled();
  await expect(
    host.request(
      { service: "rpa.input", source: { moduleId: {}, blockId: "unknown" } },
      signal,
    ),
  ).rejects.toThrow("BLK-RUN-SERVICE");
  expect(manualInput).not.toHaveBeenCalled();
  const handle = (await host.request(
    { service: "rpa.open", input: rpaRequest() },
    signal,
  )) as { handle: string };
  await expect(
    host.request(
      {
        service: "rpa.perform",
        handle: handle.handle,
        step: { ...rpaRequest().plan.steps[0], action: "click" },
      },
      signal,
    ),
  ).rejects.toThrow("BLK-RUN-SERVICE");
  expect(perform).not.toHaveBeenCalled();
  await host.request(
    {
      service: "rpa.perform",
      handle: handle.handle,
      step: rpaRequest().plan.steps[0],
    },
    signal,
  );
  expect(perform).toHaveBeenCalledOnce();
  await host.close();
});

it.each(["read", "fill"] as const)("preserves reviewed RPA %s steps when native JSON transport reorders object keys", async (action) => {
  // Rust serde_json maps do not preserve JavaScript insertion order. Reorder both
  // the envelope and nested locator without changing the authorized operation.
  const nativeWire = (value: unknown) => JSON.parse(JSON.stringify(value, (_key, item) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item));
  const adapters = localAdapters(), perform = vi.fn(async () => ({}));
  adapters.rpa = { open: async () => ({ checkpointId: "checkpoint-owned", close: async () => {}, perform }) };
  const host = new RuntimeServiceHost("project-one", adapters), signal = new AbortController().signal;
  try {
    const request = rpaRequest();
    const step = { ...request.plan.steps[0], action,
      ...(action === "fill" ? { value: { kind: "manual-input", sensitive: true }, effectKey: "fill-effect" } : {}),
    };
    const planRequest = { ...request, plan: { ...request.plan, steps: [step] },
      inputSources: action === "fill" ? { read: "manual" } : {},
    };
    const opened = await host.request(nativeWire({ service: "rpa.open", input: planRequest }), signal) as { handle: string };
    const input = action === "fill" ? { input: "SYNTHETIC_MANUAL_INPUT" } : {};
    await host.request(nativeWire({ service: "rpa.perform", handle: opened.handle, step, ...input }), signal);
    expect(perform).toHaveBeenCalledExactlyOnceWith(step, input.input, expect.any(AbortSignal));
    for (const altered of [
      { ...step, timeoutMs: 2000 },
      { ...step, locator: { ...step.locator, automationId: "another-control" } },
      { ...step, extra: "undeclared" },
      { ...step, locator: { ...step.locator, extra: "undeclared" } },
      ...(action === "fill" ? [
        { ...step, value: { kind: "manual-input", sensitive: false } },
        { ...step, value: { kind: "secret-ref", ref: "foreign-secret" } },
        { ...step, effectKey: "another-effect" },
      ] : []),
    ]) await expect(host.request(nativeWire({ service: "rpa.perform", handle: opened.handle, step: altered, ...input }), signal))
      .rejects.toThrow("BLK-RUN-SERVICE");
    expect(perform).toHaveBeenCalledTimes(1);
  } finally { await host.close(); }
});

it("closes an RPA handle arriving after close timed out and rejects its former caller", async () => {
  vi.useFakeTimers();
  try {
    let release!: (handle: {
      checkpointId: string;
      close: () => Promise<void>;
      perform: () => Promise<{}>;
    }) => void;
    const adapters = localAdapters();
    adapters.rpa = {
      open: async () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    };
    const host = new RuntimeServiceHost("project-one", adapters);
    const opened = host.request(
      { service: "rpa.open", input: rpaRequest() },
      new AbortController().signal,
    );
    const openingResult = opened.then(
      (value) => ({ value }),
      (error) => ({ error }),
    );
    const closingResult = host.close().then(
      () => "resolved",
      (error) => error.message,
    );
    await vi.advanceTimersByTimeAsync(10001);
    expect(await closingResult).toBe("BLK-RUN-SERVICE");
    const close = vi.fn(async () => {});
    release({
      checkpointId: "checkpoint-late",
      close,
      perform: async () => ({}),
    });
    expect(await openingResult).toEqual({ error: Error("BLK-RUN-SERVICE") });
    expect(close).toHaveBeenCalledOnce();
  } finally {
    vi.useRealTimers();
  }
});

it("retains failed late-handle settlement without issuing duplicate closes", async () => {
  const adapters = localAdapters();
  let release!: (handle: {
    checkpointId: string;
    close: () => Promise<void>;
    perform: () => Promise<{}>;
  }) => void;
  adapters.rpa = {
    open: async () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  };
  const host = new RuntimeServiceHost("project-one", adapters),
    abort = new AbortController();
  const opened = host.request(
    { service: "rpa.open", input: rpaRequest() },
    abort.signal,
  );
  const rejected = expect(opened).rejects.toThrow("BLK-RPA-UNSETTLED");
  abort.abort();
  const close = vi.fn(async () => {
    throw Error("BLK-RPA-UNSETTLED");
  });
  release({
    checkpointId: "checkpoint-late",
    close,
    perform: async () => ({}),
  });
  await rejected;
  await expect(host.close()).rejects.toThrow("BLK-RPA-UNSETTLED");
  await expect(host.close()).rejects.toThrow("BLK-RPA-UNSETTLED");
  expect(close).toHaveBeenCalledOnce();
});
