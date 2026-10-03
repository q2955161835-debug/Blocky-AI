import { expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { Runtime } from "../src";
import { parseRuntimeSession } from "../src/session-state";
import { EventMailbox } from "../src/event-mailbox";
import { createArchitectureStarter } from "../../test-fixtures/src/scenarios";

it("carries memory and trace order across fresh runtimes without leaking state between projects", async () => {
  const project = createArchitectureStarter("state-machine"),
    runtime = new Runtime();
  const first = await runtime.run(project, "on-event", "start");
  expect(first.structured).toBe("running");
  const state = runtime.captureSession();
  expect(state.memory.length).toBeGreaterThan(0);
  const restored = new Runtime({ sessionState: state });
  state.memory[0].value = "tampered";
  const next = await restored.run(project, "on-event", "finish");
  expect(next.structured).toBe("done");
  expect(next.events[0].sequence).toBeGreaterThan(
    first.events.at(-1)!.sequence,
  );
  expect(
    (
      await restored.run(
        createArchitectureStarter("state-machine"),
        "on-event",
        "finish",
      )
    ).structured,
  ).toBe("idle");
  expect(restored.captureSession().sessionId).toBe(
    runtime.captureSession().sessionId,
  );
  expect(
    () =>
      new Runtime({
        sessionState: runtime.captureSession(),
        sessionId: "other-session",
      }),
  ).toThrow("BLK-RUN-STATE");
  expect(
    () =>
      new Runtime({
        sessionState: runtime.captureSession(),
        nextSequence: () => 1,
      }),
  ).toThrow("BLK-RUN-STATE");
});

it("preserves all project queues and FIFO and clones both sides of the private state", async () => {
  const project = createArchitectureStarter("event-mailbox"),
    other = createArchitectureStarter("event-mailbox"),
    runtime = new Runtime();
  await runtime.run(project, "on-event", "private-first");
  await runtime.run(other, "on-event", "other-private");
  await runtime.run(project, "on-event", "private-second");
  const state = runtime.captureSession();
  const restored = new Runtime({ sessionState: state });
  state.mailbox[0].payload = "changed";
  expect((await restored.run(other, "on-event", "next")).structured).toBe(
    "other-private",
  );
  const first = await restored.run(project, "on-event", "next");
  expect(first.structured).toBe("private-first");
  expect(JSON.stringify(first.events)).not.toContain("private-first");
  expect((await restored.run(project, "on-event", "next")).structured).toBe(
    "private-second",
  );
  expect((await restored.run(project, "on-event", "next")).structured).toBe(
    "empty",
  );
  expect((await runtime.run(project, "on-event", "next")).structured).toBe(
    "private-first",
  );
});

it("never captures while a run is paused or executing", async () => {
  const runtime = new Runtime(),
    project = createArchitectureStarter("state-machine"),
    abort = new AbortController();
  let checked = false;
  const result = await runtime.run(project, "on-event", "start", {
    signal: abort.signal,
    onEvent(event) {
      if (event.type === "run.started") {
        expect(() => runtime.captureSession()).toThrow("BLK-RUN-STATE");
        checked = true;
        abort.abort();
      }
    },
  });
  expect(checked).toBe(true);
  expect(result.status).toBe("cancelled");
  expect(runtime.captureSession().schemaVersion).toBe(
    "blocky.runtime-state/v1",
  );
});

it("rejects malformed or oversized state without invoking accessors", () => {
  const valid = new Runtime().captureSession();
  const wrong = [
    { ...valid, schemaVersion: "blocky.runtime-state/v999" },
    { ...valid, grant: "not-a-capability" },
    { ...valid, sequence: -1 },
    { ...valid, sequence: Number.MAX_SAFE_INTEGER },
    { ...valid, sessionId: "../session" },
    {
      ...valid,
      memory: [
        { projectId: "p", key: "x", value: 1 },
        { projectId: "p", key: "x", value: 2 },
      ],
    },
    { ...valid, memory: [{ projectId: "../p", key: "x", value: 1 }] },
    {
      ...valid,
      memory: [{ projectId: "p", key: "x", value: "x".repeat(32769) }],
    },
    {
      ...valid,
      mailbox: Array.from({ length: 129 }, () => ({
        projectId: "p",
        channel: "c",
        payload: 1,
      })),
    },
    {
      ...valid,
      mailbox: [{ projectId: "p", channel: "c", payload: "x".repeat(16001) }],
    },
    { ...valid, mailbox: [{ projectId: "p", channel: "../c", payload: 1 }] },
    {
      ...valid,
      memory: Array.from({ length: 40 }, (_, i) => ({
        projectId: "p",
        key: `k-${i}`,
        value: "x".repeat(32700),
      })),
    },
  ];
  for (const state of wrong)
    expect(() => new Runtime({ sessionState: state })).toThrow("BLK-RUN-STATE");
  let invoked = false;
  const bad = Object.defineProperty({}, "schemaVersion", {
    enumerable: true,
    get() {
      invoked = true;
      return valid.schemaVersion;
    },
  });
  expect(() => parseRuntimeSession(bad)).toThrow("BLK-RUN-STATE");
  expect(invoked).toBe(false);
  expect(new Runtime({ sessionState: valid }).captureSession()).toEqual(valid);
});

it("transfers only data through actual fresh Node processes", () => {
  const project = createArchitectureStarter("event-mailbox");
  let state: unknown;
  let previous = 0;
  for (const [input, expected] of [
    ["cross-process-private", "queued"],
    ["next", "cross-process-private"],
    ["next", "empty"],
  ]) {
    const child = spawnSync(
      process.execPath,
      [
        resolve("node_modules/tsx/dist/cli.mjs"),
        resolve("packages/runtime-core/tests/session-state.fixture.ts"),
      ],
      {
        windowsHide: true,
        env: { ...process.env, TSX_DISABLE_CACHE: "1" },
        encoding: "utf8",
        timeout: 20000,
        input: JSON.stringify({ project, input, state }),
      },
    );
    expect(child.status, child.stderr).toBe(0);
    const output = JSON.parse(child.stdout);
    expect(output.result.structured).toBe(expected);
    expect(output.result.events[0].sequence).toBeGreaterThan(previous);
    previous = output.result.events.at(-1).sequence;
    expect(output.result.modelApiCalled).toBe(false);
    state = output.state;
  }
}, 60000);

it("preserves dense memory within the existing byte budget rather than silently truncating it", () => {
  const state = new Runtime({ sessionId: "s" }).captureSession();
  state.memory = Array.from({ length: 14000 }, (_, index) => ({
    projectId: "p",
    key: `k-${index}`,
    value: null,
  }));
  expect(new Runtime({ sessionState: state }).captureSession()).toEqual(state);
});

it("accounts for envelope depth separately from the payload limit", () => {
  const state = new Runtime().captureSession();
  let value: import("@blocky/language-schema").Json = 1;
  for (let index = 0; index < 32; index++) value = [value];
  state.memory = [{ projectId: "p", key: "k", value }];
  state.mailbox = [{ projectId: "p", channel: "c", payload: value }];
  expect(new Runtime({ sessionState: state }).captureSession()).toEqual(state);
  state.memory[0].value = [value];
  expect(new Runtime({ sessionState: state }).captureSession()).toEqual(state);
});

it("never invokes inherited Array serialization behavior", () => {
  let invoked = 0;
  class CustomArray extends Array {
    get toJSON() {
      invoked++;
      return () => [];
    }
  }
  const state = new Runtime().captureSession();
  state.memory = new CustomArray();
  expect(() => parseRuntimeSession(state)).toThrow("BLK-RUN-STATE");
  expect(invoked).toBe(0);
});

it.each([33, 128])(
  "transfers depth %s actually accepted by normal memory writes",
  async (depth) => {
    let value: import("@blocky/language-schema").Json = 1;
    for (let index = 0; index < depth; index++) value = [value];
    const project = createArchitectureStarter("state-machine");
    project.workspaces.main.blocks.blocks[0].inputs!.HANDLER = {
      block: {
        id: "set-deep",
        type: "core.data.set",
        fields: { VALUE: JSON.stringify(value) },
        next: {
          block: {
            id: "save-deep",
            type: "core.memory.write",
            fields: { SCOPE: "session", KEY: "deep", SOURCE: "result" },
          },
        },
      },
    };
    const runtime = new Runtime();
    const result = await runtime.run(project, "on-event", "synthetic");
    expect(result.status).toBe("completed");
    expect(result.modelApiCalled).toBe(false);
    const state = runtime.captureSession();
    expect(JSON.stringify(state.memory[0].value)).toBe(JSON.stringify(value));
    expect(new Runtime({ sessionState: state }).captureSession()).toEqual(
      state,
    );
  },
);

it("rejects mailbox replacement and pending receivers, and validates the whole queue before mutation", async () => {
  const mailbox = new EventMailbox(),
    abort = new AbortController();
  const wait = mailbox.receive("p", "c", 30000, abort.signal);
  expect(() => mailbox.captureSession()).toThrow("BLK-RUN-STATE");
  expect(() => mailbox.restoreSession([])).toThrow("BLK-RUN-STATE");
  abort.abort();
  await expect(wait).rejects.toBeDefined();
  expect(() =>
    mailbox.restoreSession([
      { projectId: "p", channel: "c", payload: 1 },
      { projectId: "../bad", channel: "c", payload: 2 },
    ]),
  ).toThrow("BLK-RUN-STATE");
  expect(mailbox.captureSession()).toEqual([]);
  mailbox.send("p", "c", "keep", new AbortController().signal);
  expect(() => mailbox.restoreSession([])).toThrow("BLK-RUN-STATE");
  expect(mailbox.captureSession()).toEqual([
    { projectId: "p", channel: "c", payload: "keep" },
  ]);
});
