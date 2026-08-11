import { createDeterministicModel, type RuntimeDependencies } from "../core/deterministicRuntime";
import type { RuntimeEvent } from "../core/runtimeEvents";

export interface WdioSupport {
  readonly runtimeModel: RuntimeDependencies["model"];
  readonly onRuntimeEvent: (event: RuntimeEvent) => void;
}

function createObservableModel(): RuntimeDependencies["model"] {
  const deterministic = createDeterministicModel();
  return {
    async *stream(input, signal) {
      for await (const chunk of deterministic.stream(input, signal)) {
        await new Promise((resolve) => window.setTimeout(resolve, 250));
        yield chunk;
      }
    },
  };
}

export async function installWdioSupport(): Promise<WdioSupport | undefined> {
  if (import.meta.env.MODE !== "wdio") return undefined;
  await import("@wdio/tauri-plugin");
  const { installWdioHooks, recordRuntimeEvent } = await import("./wdioHooks");
  installWdioHooks();
  return {
    runtimeModel: createObservableModel(),
    onRuntimeEvent: recordRuntimeEvent,
  };
}
