import { runBuilderEngine, type BuilderGeneration } from "./index";
import { inspectBuilder, parseBuilderRequest } from "@blocky/builder-protocol";
import type { Project, Resource } from "@blocky/language-schema";
import { localBuilderResponse } from "./local";
import { safeBuilderError } from "./transport";
import { readBuilderRegistry } from "./provider-registry";

const controller = new AbortController();
let started = false,
  requestId = "",
  pending:
    | {
        turn: number;
        resolve: (v: BuilderGeneration) => void;
        reject: (e: Error) => void;
      }
    | undefined;
let buffer = "";
function send(value: Record<string, unknown>) {
  const line = JSON.stringify({
    schemaVersion: "blocky.builder-ipc/v1",
    requestId,
    ...value,
  });
  if (Buffer.byteLength(line) > 2 * 1024 * 1024)
    throw Error("BLK-BUILDER-BUDGET");
  process.stdout.write(line + "\n");
}
function end(error?: unknown) {
  controller.abort();
  pending?.reject(Error("BLK-BUILDER-CANCELLED"));
  pending = undefined;
  if (error) send({ kind: "error", code: safeBuilderError(error) });
  process.stdin.destroy();
}
async function receive(value: Record<string, unknown>) {
  if (value.schemaVersion !== "blocky.builder-ipc/v1")
    throw Error("BLK-BUILDER-WIRE");
  if (value.kind === "start") {
    if (
      started ||
      Object.keys(value).some(
        (k) =>
          ![
            "schemaVersion",
            "kind",
            "requestId",
            "request",
            "project",
            "registry",
            "mode",
            "modelId",
          ].includes(k),
      )
    )
      throw Error("BLK-BUILDER-WIRE");
    started = true;
    const request = parseBuilderRequest(value.request);
    requestId = request.requestId;
    if (
      value.requestId !== requestId ||
      !["deterministic", "live"].includes(String(value.mode))
    )
      throw Error("BLK-BUILDER-WIRE");
    const project = value.project as Project;
    const registry = readBuilderRegistry(value.registry);
    const inspection = await inspectBuilder(project, request, registry);
    const result = await runBuilderEngine(project, request, {
      registry,
      mode: value.mode as "live" | "deterministic",
      modelId: String(value.modelId),
      signal: controller.signal,
      onEvent: (event) => send({ kind: "event", event }),
      generate: async (input, signal) => {
        signal.throwIfAborted();
        if (value.mode === "deterministic")
          return localBuilderResponse(request, inspection);
        return new Promise<BuilderGeneration>((resolve, reject) => {
          if (pending) {
            reject(Error("BLK-BUILDER-WIRE"));
            return;
          }
          pending = { turn: input.turn, resolve, reject };
          send({
            kind: "provider.call",
            turn: input.turn,
            messages: input.messages,
          });
        });
      },
    });
    send({ kind: "complete", result });
    end();
  } else {
    if (value.requestId !== requestId || !started)
      throw Error("BLK-BUILDER-WIRE");
    if (value.kind === "cancel") {
      end();
      return;
    }
    if (
      Object.keys(value).some(
        (k) =>
          ![
            "schemaVersion",
            "kind",
            "requestId",
            "turn",
            "value",
            "code",
          ].includes(k),
      ) ||
      value.turn !== pending?.turn
    )
      throw Error("BLK-BUILDER-WIRE");
    const call = pending;
    pending = undefined;
    if (value.kind === "provider.result")
      call!.resolve(value.value as BuilderGeneration);
    else if (value.kind === "provider.error")
      call!.reject(Error(safeBuilderError(value.code)));
    else throw Error("BLK-BUILDER-WIRE");
  }
}
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk: string) => {
  buffer += chunk;
  if (Buffer.byteLength(buffer) > 16 * 1024 * 1024) {
    end(Error("BLK-BUILDER-BUDGET"));
    return;
  }
  let split: number;
  while ((split = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, split);
    buffer = buffer.slice(split + 1);
    try {
      void receive(JSON.parse(line)).catch(end);
    } catch (error) {
      end(error);
    }
  }
});
process.stdin.on("end", () => {
  if (!controller.signal.aborted) end(Error("BLK-BUILDER-CANCELLED"));
});
