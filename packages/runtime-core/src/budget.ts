import { parseBudgetCheckpoint, type BudgetCheckpoint } from "./workflow/context";
export const utf8 = (text: string) => new TextEncoder().encode(text).length;
export function integer(value: unknown, min: number, max: number): number {
  const n =
    typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  if (typeof n !== "number" || !Number.isSafeInteger(n) || n < min || n > max)
    throw Error("BLK-RUN-006");
  return n;
}
/** A local deadline also settles non-cooperative adapters; late values are discarded. */
export function abortable<T>(
  work: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      cleanup();
      reject(signal.reason ?? Error("BLK-RUN-005"));
    };
    const cleanup = () => signal.removeEventListener("abort", abort);
    signal.addEventListener("abort", abort, { once: true });
    work.then(
      (value) => {
        cleanup();
        if (signal.aborted) reject(signal.reason);
        else resolve(value);
      },
      (error) => {
        cleanup();
        reject(error);
      },
    );
    if (signal.aborted) abort();
  });
}
export class RunBudget {
  steps = 0;
  calls = 0;
  usedOutput = 0;
  maxSteps = 2000;
  maxCalls = 16;
  maxOutput = 4096;
  readonly controller = new AbortController();
  private timer: ReturnType<typeof setTimeout>;
  private readonly started = Date.now();
  private timedOut = false;
  private maxDuration = 120000;
  private cancel: () => void;
  constructor(private parent?: AbortSignal) {
    this.cancel = () => this.controller.abort(parent?.reason);
    parent?.addEventListener("abort", this.cancel, { once: true });
    if (parent?.aborted) this.cancel();
    this.timer = setTimeout(() => this.expire(), 120000);
  }
  get signal() {
    return this.controller.signal;
  }
  get timeout() {
    return this.timedOut;
  }
  checkpoint():BudgetCheckpoint {
    return parseBudgetCheckpoint({steps:this.steps,calls:this.calls,usedOutput:this.usedOutput,maxSteps:this.maxSteps,maxCalls:this.maxCalls,maxOutput:this.maxOutput,remainingMs:Math.max(0,this.maxDuration-(Date.now()-this.started))});
  }
  restoreCheckpoint(input:unknown):void {
    const value=parseBudgetCheckpoint(input);
    this.signal.throwIfAborted();
    const elapsed=Date.now()-this.started,remaining=Math.min(this.maxDuration-elapsed,value.remainingMs);
    if(remaining<=0)throw Error("BLK-RUN-007");
    const steps=Math.max(this.steps,value.steps),calls=Math.max(this.calls,value.calls),output=Math.max(this.usedOutput,value.usedOutput);
    const maxSteps=Math.min(this.maxSteps,value.maxSteps),maxCalls=Math.min(this.maxCalls,value.maxCalls),maxOutput=Math.min(this.maxOutput,value.maxOutput);
    if(steps>maxSteps||calls>maxCalls||output>maxOutput)throw Error("BLK-RUN-004");
    this.steps=steps;this.calls=calls;this.usedOutput=output;this.maxSteps=maxSteps;this.maxCalls=maxCalls;this.maxOutput=maxOutput;this.maxDuration=elapsed+remaining;
    clearTimeout(this.timer);this.timer=setTimeout(()=>this.expire(),remaining);
  }
  private expire() {
    this.timedOut = true;
    this.controller.abort(Error("BLK-RUN-007"));
  }
  configure(fields: Record<string, unknown>) {
    this.maxSteps = Math.min(this.maxSteps, integer(fields.STEPS, 1, 2000));
    this.maxCalls = Math.min(this.maxCalls, integer(fields.CALLS, 1, 16));
    this.maxOutput = Math.min(
      this.maxOutput,
      integer(fields.OUTPUT_TOKENS, 1, 4096),
    );
    this.maxDuration = Math.min(
      this.maxDuration,
      integer(fields.TIMEOUT_MS, 1, 120000),
    );
    clearTimeout(this.timer);
    const remaining = this.maxDuration - (Date.now() - this.started);
    if (remaining <= 0) this.expire();
    else this.timer = setTimeout(() => this.expire(), remaining);
    this.check();
  }
  check() {
    this.signal.throwIfAborted();
    if (
      this.steps > this.maxSteps ||
      this.calls > this.maxCalls ||
      this.usedOutput > this.maxOutput
    )
      throw Error("BLK-RUN-004");
  }
  step() {
    this.steps++;
    this.check();
  }
  call() {
    this.calls++;
    this.check();
  }
  reserveOutput(requested: number) {
    const allowed = Math.min(
      integer(requested, 1, 4096),
      this.maxOutput - this.usedOutput,
    );
    if (allowed < 1) throw Error("BLK-RUN-004");
    this.usedOutput += allowed;
    return allowed;
  }
  dispose() {
    clearTimeout(this.timer);
    this.parent?.removeEventListener("abort", this.cancel);
  }
}

export function wait(ms: number, signal: AbortSignal) {
  if (signal.aborted) return Promise.reject(signal.reason);
  if (ms <= 0) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const end = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
    };
    const abort = () => {
      end();
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      end();
      resolve();
    }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
}
