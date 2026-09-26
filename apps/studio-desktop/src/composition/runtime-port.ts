import { Channel, invoke } from "@tauri-apps/api/core";
import type { RunResult } from "@blocky/runtime-core";
export type RuntimeFrame =
  | { kind: "ready" | "settle" }
  | { kind: "service"; id: number; request: Record<string, unknown> }
  | { kind: "event"; value: RunResult["events"][number] };
export interface RuntimePort {
  open(): Promise<string>;
  run(
    sessionId: string,
    runId: string,
    request: unknown,
    receive: (frame: RuntimeFrame) => void,
  ): Promise<RunResult>;
  send(sessionId: string, runId: string, message: unknown): Promise<void>;
  close(sessionId: string): Promise<void>;
}
export const runtimePort: RuntimePort = {
  open: () => invoke("runtime_session_open"),
  run: (sessionId, runId, request, receive) => {
    const channel = new Channel<RuntimeFrame>();
    channel.onmessage = receive;
    return invoke("runtime_run", { sessionId, runId, request, channel });
  },
  send: (sessionId, runId, message) =>
    invoke("runtime_request", { sessionId, runId, message }),
  close: (sessionId) => invoke("runtime_session_close", { sessionId }),
};
