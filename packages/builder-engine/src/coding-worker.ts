import { parseCodingStart } from "@blocky/builder-protocol";
import { runCodingAgent, safeCodingError } from "./coding";
import type { BuilderGeneration } from "./transport";
import { CodingGenerationError } from "./generation-error";

/** A single-task IPC handler. worker.ts alone owns stdin and selects this protocol from its first frame. */
export function createCodingWorker(io: {
  send(frame: Record<string, unknown>): void;
  close(): void;
}) {
  const controller = new AbortController();
  let requestId = "",
    started = false,
    ended = false;
  let provider:
    | {
        turn: number;
        resolve(value: BuilderGeneration): void;
        reject(error: Error): void;
      }
    | undefined;
  let tool:
    | {
        callId: string;
        resolve(value: unknown): void;
        reject(error: Error): void;
      }
    | undefined;
  function send(value: Record<string, unknown>) {
    if (ended) return;
    const frame = {
      schemaVersion: "blocky.coding-ipc/v1",
      requestId,
      ...value,
    };
    if (
      new TextEncoder().encode(JSON.stringify(frame)).length >
      16 * 1024 * 1024
    )
      throw Error("BLK-CODING-BUDGET");
    io.send(frame);
  }
  function end(error?: unknown) {
    if (ended) return;
    if (error) send({ kind: "error", code: safeCodingError(error) });
    ended = true;
    controller.abort();
    provider?.reject(Error("BLK-CODING-CANCELLED"));
    provider = undefined;
    tool?.reject(Error("BLK-CODING-CANCELLED"));
    tool = undefined;
    io.close();
  }
  function keys(value: Record<string, unknown>, allowed: string[]) {
    if (
      Object.keys(value).some(
        (key) =>
          !["schemaVersion", "requestId", "kind", ...allowed].includes(key),
      )
    )
      throw Error("BLK-CODING-WIRE");
  }
  async function receive(value: Record<string, unknown>) {
    if (
      !value ||
      Array.isArray(value) ||
      value.schemaVersion !== "blocky.coding-ipc/v1" ||
      ended
    )
      throw Error("BLK-CODING-WIRE");
    if (value.kind === "start") {
      keys(value, ["start", "modelId"]);
      if (
        started ||
        typeof value.modelId !== "string" ||
        !value.modelId.length ||
        value.modelId.length > 200
      )
        throw Error("BLK-CODING-WIRE");
      const start = parseCodingStart(value.start);
      if (value.requestId !== start.requestId) throw Error("BLK-CODING-WIRE");
      started = true;
      requestId = start.requestId;
      try {
        const result = await runCodingAgent(start, {
          modelId: value.modelId,
          signal: controller.signal,
          onEvent: (event) => send({ kind: "event", event }),
          generate: async (input, signal) => {
            if (signal?.aborted) throw Error("BLK-CODING-CANCELLED");
            return new Promise<BuilderGeneration>((resolve, reject) => {
              if (provider || tool) {
                reject(Error("BLK-CODING-WIRE"));
                return;
              }
              provider = { turn: input.turn, resolve, reject };
              send({
                kind: "provider.call",
                turn: input.turn,
                messages: input.messages,
              });
            });
          },
          executeTool: async (name, args, context) => {
            if (controller.signal.aborted) throw Error("BLK-CODING-CANCELLED");
            return new Promise((resolve, reject) => {
              if (tool || provider || !context?.callId) {
                reject(Error("BLK-CODING-WIRE"));
                return;
              }
              tool = { callId: context.callId, resolve, reject };
              send({ kind: "tool.call", callId: context.callId, name, args });
            });
          },
        });
        if (!controller.signal.aborted) send({ kind: "complete", result });
        end();
      } catch (error) {
        if (!ended) end(error);
      }
      return;
    }
    if (!started || value.requestId !== requestId)
      throw Error("BLK-CODING-WIRE");
    if (value.kind === "cancel") {
      keys(value, []);
      end();
      return;
    }
    if (value.kind === "provider.result" || value.kind === "provider.error") {
      keys(
        value,
        value.kind === "provider.result" ? ["turn", "value"] : ["turn", "code", "generation"],
      );
      if (!provider || value.turn !== provider.turn)
        throw Error("BLK-CODING-WIRE");
      const call = provider;
      provider = undefined;
      if (value.kind === "provider.result")
        call.resolve(value.value as BuilderGeneration);
      else {
        try {
          call.reject(new CodingGenerationError(safeCodingError(value.code), value.generation));
        } catch {
          call.reject(Error("BLK-CODING-WIRE"));
        }
      }
      return;
    }
    if (value.kind === "tool.result") {
      keys(
        value,
        value.ok === true
          ? ["callId", "ok", "result"]
          : ["callId", "ok", "code"],
      );
      if (
        !tool ||
        value.callId !== tool.callId ||
        typeof value.ok !== "boolean" ||
        (value.ok === true
          ? !Object.hasOwn(value, "result")
          : typeof value.code !== "string")
      )
        throw Error("BLK-CODING-WIRE");
      const call = tool;
      tool = undefined;
      if (value.ok === true) call.resolve(value.result);
      else call.reject(Error(safeCodingError(value.code)));
      return;
    }
    throw Error("BLK-CODING-WIRE");
  }
  return { receive, end };
}
