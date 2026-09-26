import { readRpaResult, type RpaModulePorts } from "@blocky/rpa-core";
import { rpaNative } from "./rpa";
const error = (value: unknown) =>
  Error(String(value).match(/BLK-RPA-[A-Z0-9-]+/)?.[0] ?? "BLK-RPA-WORKER-001");
export function studioRpaModules(
  manualInput: NonNullable<RpaModulePorts["manualInput"]>,
): RpaModulePorts {
  return {
    manualInput,
    open: async (request, signal) => {
      signal.throwIfAborted();
      const requestId = `approval-${crypto.randomUUID()}`;
      let token: string | undefined, stopPromise: Promise<void> | undefined;
      const close = () =>
        (stopPromise ??= (
          token
            ? rpaNative.stop(token)
            : rpaNative.cancelAuthorization(requestId)
        ).catch((e) => {
          throw error(e);
        }));
      const stop = () => {
        void close().catch(() => {});
      };
      signal.addEventListener("abort", stop, { once: true });
      try {
        const grant = await rpaNative.authorize(
          request.plan,
          requestId,
          request.browser,
        );
        token = grant.sessionId;
        if (signal.aborted) {
          await stopPromise;
          stopPromise = undefined;
          await close();
          signal.throwIfAborted();
        }
        const status = await rpaNative.status(token);
        if (!status.checkpointId) throw Error("BLK-RPA-JOURNAL-001");
        return {
          checkpointId: status.checkpointId,
          perform: async (step, input, stepSignal) => {
            stepSignal.throwIfAborted();
            try {
              return readRpaResult(
                await rpaNative.step(token!, step.stepId, input),
              );
            } catch (e) {
              throw error(e);
            }
          },
          close: async () => {
            signal.removeEventListener("abort", stop);
            await close();
          },
        };
      } catch (e) {
        signal.removeEventListener("abort", stop);
        await close();
        throw error(e);
      }
    },
  };
}
