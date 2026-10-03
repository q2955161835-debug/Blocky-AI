import { expect, it } from "vitest";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import {
  RuntimeServiceHost,
  localAdapters,
} from "../../packages/runtime-core/src";
import { createArchitectureStarter } from "../../packages/test-fixtures/src/scenarios";
import { createStarter } from "../../packages/test-fixtures/src";

it.each([
  ["service", "BLK-KNOWLEDGE-NO-INDEX", "BLK-KNOWLEDGE-NO-INDEX"],
  ["service", "unexpected failure", "BLK-RUN-SERVICE"],
  [
    "service",
    "BLK-KNOWLEDGE-NO-INDEX: D:\\private\\source.txt",
    "BLK-RUN-SERVICE",
  ],
  ["open", "BLK-KNOWLEDGE-NO-INDEX", "BLK-WORKFLOW-CHANNEL"],
] as const)(
  "routes desktop worker %s error reply %s to %s through real stdin/stdout",
  async (operation, suppliedCode, expectedCode) => {
    const project =
      operation === "service"
        ? createStarter()
        : createArchitectureStarter("durable-workflow");
    if (operation === "service") {
      project.resources["product-handbook"].definition = {
        collection: "product-handbook",
        implementationRef: { kind: "adapter", id: "knowledge-local-v1" },
        sourceRef: { kind: "resource", id: "product-handbook" },
        chunking: { strategy: "paragraph", size: 768, overlap: 64 },
        index: { strategy: "keyword" },
        retrieval: { strategy: "keyword", topK: 5 },
      };
    }
    const host = new RuntimeServiceHost(
      project.manifest.projectId,
      localAdapters(),
    );
    const child = spawn(
      resolve("tools/blocky-cli/dist/bin/builder/node.exe"),
      [
        "--no-addons",
        "--no-global-search-paths",
        resolve("tools/blocky-cli/dist/runtime-worker.mjs"),
      ],
      { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
    );
    let buffer = "",
      injected = false;
    const frames: any[] = [];
    const send = (value: unknown) =>
      child.stdin.write(JSON.stringify(value) + "\n");
    const exited = new Promise<number | null>((done, reject) => {
      child.once("error", reject);
      child.once("close", done);
    });
    child.stderr.resume();
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      let end: number;
      while ((end = buffer.indexOf("\n")) >= 0) {
        const frame = JSON.parse(buffer.slice(0, end));
        buffer = buffer.slice(end + 1);
        frames.push(frame);
        if (frame.kind !== "workflow") continue;
        if (
          !injected &&
          frame.operation === operation &&
          (operation !== "service" ||
            frame.request.service === "knowledge.query")
        ) {
          injected = true;
          send({
            kind: "reply",
            id: frame.id,
            ok: false,
            value: { code: suppliedCode },
          });
        } else if (frame.operation === "service") {
          void host.request(frame.request, new AbortController().signal).then(
            (value) => send({ kind: "reply", id: frame.id, ok: true, value }),
            () =>
              send({
                kind: "reply",
                id: frame.id,
                ok: false,
                value: { code: "BLK-RUN-SERVICE" },
              }),
          );
        } else {
          send({
            kind: "reply",
            id: frame.id,
            ok: false,
            value: { code: "BLK-WORKFLOW-CHANNEL" },
          });
        }
      }
    });
    const timer = setTimeout(() => child.kill(), 10000);
    try {
      send({
        kind: "start",
        schemaVersion: "blocky.desktop-session/v1",
        request: {
          schemaVersion: "blocky.desktop-run/v1",
          project,
          interactionId: operation === "service" ? "on-question" : "on-event",
          question: operation === "service" ? "水循环" : "start",
          options: {},
        },
      });
      expect(await exited).toBe(0);
      expect(injected).toBe(true);
      const done = frames.find((frame) => frame.kind === "desktop-done");
      expect(done?.value.result.status).toBe("failed");
      expect(
        frames.find(
          (frame) =>
            frame.kind === "event" && frame.value.type === "run.failed",
        )?.value.data.code,
      ).toBe(expectedCode);
      if (operation === "service") {
        expect(
          frames.find(
            (frame) =>
              frame.kind === "event" && frame.value.type === "tool.failed",
          )?.value.data.code,
        ).toBe(expectedCode);
      }
      expect(
        JSON.stringify(frames.filter((frame) => frame.kind !== "workflow")),
      ).not.toContain("source.txt");
    } finally {
      clearTimeout(timer);
      if (child.exitCode === null) child.kill();
      await host.close();
    }
  },
  15000,
);

it("runs desktop state and debug controls through the pinned Node worker", async () => {
  const project = createArchitectureStarter("state-machine");
  let state: string | undefined,
    sequence = 0;
  for (const [question, expected] of [
    ["start", "running"],
    ["finish", "done"],
  ]) {
    const host = new RuntimeServiceHost(
      project.manifest.projectId,
      localAdapters(),
    );
    const child = spawn(
      resolve("tools/blocky-cli/dist/bin/builder/node.exe"),
      [
        "--no-addons",
        "--no-global-search-paths",
        resolve("tools/blocky-cli/dist/runtime-worker.mjs"),
      ],
      { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
    );
    let buffer = "",
      done: any,
      paused = 0,
      failure: unknown;
    const send = (value: unknown) =>
      child.stdin.write(JSON.stringify(value) + "\n");
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      let end: number;
      while ((end = buffer.indexOf("\n")) >= 0) {
        const frame = JSON.parse(buffer.slice(0, end));
        buffer = buffer.slice(end + 1);
        if (frame.kind === "event") {
          expect(frame.value.sequence).toBeGreaterThan(sequence);
          sequence = frame.value.sequence;
          if (frame.value.type === "run.started")
            send({ kind: "control", action: "pause" });
          if (frame.value.type === "run.paused") {
            paused++;
            send({ kind: "control", action: paused === 1 ? "step" : "resume" });
          }
        } else if (frame.kind === "workflow" && frame.operation === "service") {
          void host.request(frame.request, new AbortController().signal).then(
            (value) => send({ kind: "reply", id: frame.id, ok: true, value }),
            () =>
              send({
                kind: "reply",
                id: frame.id,
                ok: false,
                value: { code: "BLK-RUN-SERVICE" },
              }),
          );
        } else if (frame.kind === "desktop-done") done = frame.value;
        else failure = frame;
      }
    });
    try {
      const exited = new Promise<number | null>((resolve, reject) => {
        child.once("error", reject);
        child.once("close", resolve);
      });
      send({
        kind: "start",
        schemaVersion: "blocky.desktop-session/v1",
        request: {
          schemaVersion: "blocky.desktop-run/v1",
          project,
          interactionId: "on-event",
          question,
          options: {},
          ...(state ? { state } : {}),
        },
      });
      const code = await Promise.race([
        exited,
        new Promise<never>((_, reject) => {
          const timer = setTimeout(() => {
            child.kill();
            reject(Error("desktop worker timeout"));
          }, 20000);
          exited.finally(() => clearTimeout(timer));
        }),
      ]);
      expect(code).toBe(0);
      expect(failure).toBeUndefined();
      expect(paused).toBeGreaterThan(0);
      expect(done.result.status).toBe("completed");
      expect(done.result.structured).toBe(expected);
      expect(done.result.modelApiCalled).toBe(false);
      state = done.state;
    } finally {
      if (child.exitCode === null) child.kill();
      await host.close();
    }
  }
}, 45000);

it("fails promptly when the desktop owner disconnects during a service reply", async () => {
  const child = spawn(
    resolve("tools/blocky-cli/dist/bin/builder/node.exe"),
    [
      "--no-addons",
      "--no-global-search-paths",
      resolve("tools/blocky-cli/dist/runtime-worker.mjs"),
    ],
    { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
  );
  let text = "",
    disconnected = false,
    forced = false;
  const received: { kind: string }[] = [];
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    text += chunk;
    let end: number;
    while ((end = text.indexOf("\n")) >= 0) {
      const frame = JSON.parse(text.slice(0, end));
      received.push(frame);
      text = text.slice(end + 1);
      if (
        frame.kind === "workflow" &&
        frame.operation === "service" &&
        !disconnected
      ) {
        disconnected = true;
        child.stdin.end();
      }
    }
  });
  const timer = setTimeout(() => {
    forced = true;
    child.kill();
  }, 5000);
  try {
    const exited = new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });
    const project = createArchitectureStarter("state-machine");
    child.stdin.write(
      JSON.stringify({
        kind: "start",
        schemaVersion: "blocky.desktop-session/v1",
        request: {
          schemaVersion: "blocky.desktop-run/v1",
          project,
          interactionId: "on-event",
          question: "start",
          options: {},
        },
      }) + "\n",
    );
    const code = await exited;
    expect(disconnected).toBe(true);
    expect(forced).toBe(false);
    expect(code).toBe(3);
    expect(received.some((frame) => frame.kind === "desktop-done")).toBe(false);
    expect(received.some((frame) => frame.kind === "error")).toBe(true);
  } finally {
    clearTimeout(timer);
    if (child.exitCode === null) child.kill();
  }
}, 10000);
