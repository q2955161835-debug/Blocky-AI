import { invoke } from "@tauri-apps/api/core";

const codes = new Set(
  [
    "INVALID",
    "LIMIT",
    "STORE",
    "OWNER",
    "BINDING",
    "CONFLICT",
    "UNCERTAIN",
    "STATE",
    "NOT-FOUND",
    "CHANNEL",
    "CANCELLED",
    "APPROVAL",
    "EFFECT",
  ].map((code) => `BLK-WORKFLOW-${code}`),
);
export const workflowError = (value?: unknown) => {
  const code = String(value).match(/\bBLK-WORKFLOW-[A-Z-]+\b/)?.[0];
  return Error(code && codes.has(code) ? code : "BLK-WORKFLOW-CHANNEL");
};

type WaitOptions<T> = {
  signal?: AbortSignal;
  onLate?(value: T): Promise<void>;
};

/** Bounds the caller's wait. A timeout never asserts that native work stopped. */
export function waitWorkflow<T>(
  work: Promise<T>,
  options: WaitOptions<T> = {},
): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (done: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      done();
    };
    const abort = () =>
      finish(() => reject(workflowError("BLK-WORKFLOW-CANCELLED")));
    const timer = setTimeout(
      () => finish(() => reject(workflowError())),
      10000,
    );
    work.then(
      (value) => {
        if (settled) {
          // Late opens only retire their own lease; never resume or retry a run.
          void options.onLate?.(value).catch(() => {});
        } else finish(() => resolve(value));
      },
      (failure) => finish(() => reject(workflowError(failure))),
    );
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) abort();
  });
}

export function workflowCall<T>(
  command: string,
  request: unknown,
  options?: WaitOptions<T>,
): Promise<T> {
  return waitWorkflow(invoke<T>(command, { request }), options);
}
