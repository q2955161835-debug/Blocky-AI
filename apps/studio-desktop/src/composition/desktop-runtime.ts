import {
  RuntimeServiceHost,
  type Adapters,
  type Runtime,
  type RunResult,
} from "@blocky/runtime-core";
import {
  runtimePort,
  type RuntimeFrame,
  type RuntimePort,
} from "./runtime-port";
import { serializeRegistryResources } from "@blocky/resource-registry";
import { agentBudgetLimits, agentMessageLimits } from "@blocky/language-schema";
const failure = () => Error("BLK-RUN-SERVICE");
function wait<T>(
  promise: Promise<T>,
  milliseconds = 10000,
  late?: (value: T) => Promise<void>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    let expired = false;
    const timer = setTimeout(() => {
      expired = true;
      reject(failure());
    }, milliseconds);
    promise.then(
      (value) => {
        clearTimeout(timer);
        if (expired) void late?.(value).catch(() => {});
        else resolve(value);
      },
      () => {
        clearTimeout(timer);
        reject(failure());
      },
    );
  });
}
type Options = NonNullable<Parameters<Runtime["run"]>[3]>;
/** Stable renderer facade. Only the native owner can read or restore the private capsule. */
export class DesktopRuntime {
  private session?: string;
  private active?: Promise<RunResult>;
  private disposed = false;
  private broken = false;
  get needsRestart() {
    return this.broken;
  }
  private current?: {
    abort: AbortController;
    ready: boolean;
    controls: string[];
    control(action: string): void;
  };
  constructor(
    private adapters: () => Adapters,
    private port: RuntimePort = runtimePort,
  ) {}
  pause() {
    this.current?.control("pause");
  }
  resume() {
    this.current?.control("resume");
  }
  step() {
    this.current?.control("step");
  }
  run(
    project: Parameters<Runtime["run"]>[0],
    interactionId: string,
    question: string,
    options: Options = {},
  ): Promise<RunResult> {
    if (this.active || this.disposed || this.broken)
      return Promise.reject(failure());
    const work = this.execute(project, interactionId, question, options);
    this.active = work;
    void work
      .finally(() => {
        if (this.active === work) this.active = undefined;
      })
      .catch(() => {});
    return work;
  }
  private async execute(
    project: Parameters<Runtime["run"]>[0],
    interactionId: string,
    question: string,
    options: Options,
  ): Promise<RunResult> {
    const abort = new AbortController(),
      runId = `run-${crypto.randomUUID()}`;
    const cancel = () => abort.abort();
    options.signal?.addEventListener("abort", cancel, { once: true });
    if (options.signal?.aborted) cancel();
    let gateway: RuntimeServiceHost | undefined,
      error: Error | undefined,
      settling: Promise<void> | undefined;
    const services = new Set<Promise<void>>(),
      seen = new Set<number>();
    let accepting = true,
      launched = false;
    const fail = () => {
      error = failure();
      this.broken = true;
      abort.abort();
      gateway?.cancel();
    };
    const send = (message: unknown) =>
      wait(this.port.send(this.session!, runId, message));
    let controlQueue = Promise.resolve();
    const control = (action: string) => {
      if (!this.current || abort.signal.aborted) return;
      if (!this.current.ready) {
        if (this.current.controls.length < 16)
          this.current.controls.push(action);
        else fail();
        return;
      }
      controlQueue = controlQueue
        .then(() => send({ kind: "control", action }))
        .catch(fail);
    };
    this.current = { abort, ready: false, controls: [], control };
    const stop = () => {
      gateway?.cancel();
      if (this.current?.ready) void send({ kind: "cancel" }).catch(fail);
    };
    abort.signal.addEventListener("abort", stop, { once: true });
    try {
      abort.signal.throwIfAborted();
      this.session ??= await wait(this.port.open(), 10000, (token) =>
        this.port.close(token),
      );
      if (this.disposed) throw failure();
      abort.signal.throwIfAborted();
      gateway = new RuntimeServiceHost(
        project.manifest.projectId,
        this.adapters(),
      );
      const receive = (frame: RuntimeFrame) => {
        if (!accepting) return;
        try {
          switch (frame.kind) {
            case "ready": {
              if (!this.current || this.current.ready) throw failure();
              this.current.ready = true;
              if (abort.signal.aborted) stop();
              else
                for (const action of this.current.controls.splice(0))
                  control(action);
              break;
            }
            case "event":
              if (frame.value.projectId !== project.manifest.projectId)
                throw failure();
              options.onEvent?.(frame.value);
              break;
            case "cancel":
              gateway!.cancel();
              break;
            case "service": {
              if (
                settling ||
                !Number.isSafeInteger(frame.id) ||
                frame.id < 1 ||
                frame.id > agentMessageLimits.serviceCalls ||
                seen.has(frame.id)
              )
                throw failure();
              seen.add(frame.id);
              const service = gateway!
                .request(frame.request, abort.signal)
                .then(
                  (value) =>
                    send({ kind: "reply", id: frame.id, ok: true, value }),
                  (cause) =>
                    send({
                      kind: "reply",
                      id: frame.id,
                      ok: false,
                      value: {
                        code:
                          cause instanceof Error &&
                          /^BLK-[A-Z0-9-]{3,64}$/.test(cause.message)
                            ? cause.message
                            : "BLK-RUN-SERVICE",
                      },
                    }),
                )
                .catch(fail);
              services.add(service);
              void service.finally(() => services.delete(service));
              break;
            }
            case "settle":
              if (settling) throw failure();
              settling = (async () => {
                let ok = true;
                try {
                  await gateway!.close();
                  await Promise.all([...services]);
                  if (error) ok = false;
                } catch {
                  ok = false;
                  fail();
                }
                await send({ kind: "settled", ok });
                if (!ok) throw failure();
              })();
              void settling.catch(fail);
              break;
            default:
              throw failure();
          }
        } catch {
          fail();
        }
      };
      launched = true;
      const result = await wait(
        this.port.run(
          this.session,
          runId,
          {
            schemaVersion: "blocky.desktop-run/v1",
            project,
            interactionId,
            question,
            options: {
              ...(options.moduleId === undefined
                ? {}
                : { moduleId: options.moduleId }),
              ...(options.workflowTaskId === undefined
                ? {}
                : { workflowTaskId: options.workflowTaskId }),
              ...(options.conversationId === undefined
                ? {}
                : { conversationId: options.conversationId }),
              ...(options.debug === undefined ? {} : { debug: options.debug }),
              ...(options.userRegistry === undefined
                ? {}
                : {
                    userRegistry: serializeRegistryResources(
                      options.userRegistry,
                    ),
                  }),
            },
          },
          receive,
        ),
        agentBudgetLimits.durationMs + 10000,
      );
      if (!settling) throw failure();
      await settling;
      if (error || Object.hasOwn(result, "state")) throw failure();
      return result;
    } catch {
      if (launched) fail();
      throw failure();
    } finally {
      options.signal?.removeEventListener("abort", cancel);
      abort.signal.removeEventListener("abort", stop);
      accepting = false;
      try {
        await gateway?.close();
      } catch {
        this.broken = true;
        throw failure();
      } finally {
        this.current = undefined;
      }
    }
  }
  async dispose(): Promise<void> {
    this.disposed = true;
    this.current?.abort.abort();
    await this.active?.catch(() => {});
    if (this.session) {
      await wait(this.port.close(this.session));
      this.session = undefined;
    }
  }
}
