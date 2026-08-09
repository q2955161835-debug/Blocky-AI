import * as Blockly from "blockly/core";
import type { CanvasAction } from "../app/App";
import { createDeterministicModel, type RuntimeDependencies } from "../core/deterministicRuntime";

export interface WdioSupport {
  readonly runtimeModel: RuntimeDependencies["model"];
  readonly canvasAction: CanvasAction;
}

export function createWdioCanvasAction(): CanvasAction {
  return {
    ariaLabel: "折叠首块",
    label: "折叠",
    run() {
      const workspace = Blockly.getMainWorkspace();
      const block = workspace?.getBlockById("block-001")
        ?? workspace?.getTopBlocks(true)[0];
      if (!workspace || !block) return;
      block.setCollapsed(true);
    },
  };
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
  const { installWdioHooks } = await import("./wdioHooks");
  installWdioHooks();
  return {
    runtimeModel: createObservableModel(),
    canvasAction: createWdioCanvasAction(),
  };
}
