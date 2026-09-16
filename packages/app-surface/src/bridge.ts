import { validateBridgeRequest } from "./preview";
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
  ) => Promise<BridgeAnswer | undefined>,
  send: (value: unknown) => void,
) {
  let closed = false,
    active: AbortController | undefined;
  const seen = new Set<string>();
  return {
    async receive(input: unknown) {
      if (closed) return;
      let request: ReturnType<typeof validateBridgeRequest>;
      try {
        request = validateBridgeRequest(input);
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
      const timer = setTimeout(() => controller.abort(), 30000);
      try {
        const result = await run(request.question, controller.signal);
        if (!closed)
          send({
            requestId: request.requestId,
            ok: result?.status === "completed",
            answer: result?.status === "completed" ? result.answer : "",
            citations:
              result?.status === "completed"
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
      }
    },
    close() {
      closed = true;
      active?.abort();
      seen.clear();
    },
  };
}
