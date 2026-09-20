import { taskQuestion, cancelRequest } from "./task-bridge";
import type { SurfaceSpec } from "./generated";
export type BridgeAnswer = {
  status: string;
  answer: string;
  citations: { title: string; locator: string }[];
};
/** One port owns at most one run. Closing it aborts only that run. */
export function createBridge(
  run: (
    question: string,
    signal: AbortSignal,
    progress: (message: string) => void,
  ) => Promise<BridgeAnswer | undefined>,
  send: (value: unknown) => void,
  options: {
    spec?: SurfaceSpec;
    confirm?: (signal: AbortSignal) => Promise<boolean>;
  } = {},
) {
  let closed = false,
    active: AbortController | undefined,
    activeId: string | undefined;
  const seen = new Set<string>();
  return {
    async receive(input: unknown) {
      if (closed) return;
      const cancel = cancelRequest.safeParse(input);
      if (cancel.success) {
        if (cancel.data.requestId === activeId) active?.abort();
        return;
      }
      let request: ReturnType<typeof taskQuestion>;
      try {
        request = taskQuestion(input, options.spec);
      } catch {
        return;
      }
      if (active || seen.has(request.requestId) || seen.size >= 1000) {
        send({
          requestId: request.requestId,
          ok: false,
          code: "BLK-SURFACE-003",
        });
        return;
      }
      seen.add(request.requestId);
      const controller = new AbortController();
      active = controller;
      activeId = request.requestId;
      const timer = setTimeout(() => controller.abort(), 120000);
      try {
        const progress = (message: string) => {
          if (options.spec && !closed && !controller.signal.aborted)
            send({
              requestId: request.requestId,
              kind: "progress",
              message: message.slice(0, 500),
            });
        };
        if (options.spec?.confirmation) {
          progress("等待工作台确认…");
          if (!options.confirm || !(await options.confirm(controller.signal)))
            throw Error();
        }
        controller.signal.throwIfAborted();
        const result = await run(request.question, controller.signal, progress);
        if (!closed)
          send({
            requestId: request.requestId,
            ok: !controller.signal.aborted && result?.status === "completed",
            answer:
              !controller.signal.aborted && result?.status === "completed"
                ? result.answer
                : "",
            citations:
              !controller.signal.aborted && result?.status === "completed"
                ? result.citations.map(({ title, locator }) => ({
                    title,
                    locator,
                  }))
                : [],
          });
      } catch {
        if (!closed)
          send({
            requestId: request.requestId,
            ok: false,
            code: "BLK-SURFACE-003",
          });
      } finally {
        clearTimeout(timer);
        active = undefined;
        activeId = undefined;
      }
    },
    close() {
      closed = true;
      active?.abort();
      seen.clear();
    },
  };
}
