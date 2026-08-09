import * as Blockly from "blockly/core";
import { buildEditorProjection } from "../blockly/BlocklyCanvas";
import type { InteractionManifest } from "../core/interactionManifest";
import type { RuntimeEvent } from "../core/runtimeEvents";
import { createSpikeProjectSnapshot, type SpikeProjectSnapshot } from "../project/SpikeProjectSnapshot";

interface WdioSpikeTestHook {
  getBlockCount(): number;
  loadHundredBlockFixture(): void;
  getCanonicalSnapshot(): SpikeProjectSnapshot;
  getManifest(): InteractionManifest;
  startSimulation(input: string): void;
  cancelSimulation(): void;
  readRedactedEvents(): RuntimeEvent[];
  readUsedJsHeapSize(): number | null;
}

declare global {
  interface Window {
    __BLOCKY_SPIKE_TEST__?: WdioSpikeTestHook;
  }
}

function mainWorkspace(): Blockly.Workspace {
  const workspace = Blockly.getMainWorkspace();
  if (!workspace) throw new Error("WDIO_WORKSPACE_UNAVAILABLE");
  return workspace;
}

function clickButton(name: string): void {
  const button = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (candidate) => candidate.textContent?.trim() === name,
  );
  if (!button) throw new Error(`WDIO_BUTTON_UNAVAILABLE:${name}`);
  button.click();
}

function setControlledTextAreaValue(element: HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value",
  )?.set;
  if (!setter) throw new Error("WDIO_TEXTAREA_SETTER_UNAVAILABLE");
  setter.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
}

function readTimelineEvents(): RuntimeEvent[] {
  return [...document.querySelectorAll<HTMLElement>(".event-timeline__item")].map(
    (item) => {
      const sequenceText = item.querySelector(".event-timeline__meta span")?.textContent;
      const type = item.querySelector(".event-timeline__meta strong")?.textContent;
      const blockId = item.querySelector(".event-timeline__meta code")?.textContent;
      const summary = item.querySelector(".event-timeline__summary")?.textContent;
      if (!sequenceText || !type) throw new Error("WDIO_EVENT_DOM_INVALID");
      return {
        eventVersion: "blocky.event/v0-spike",
        runId: "wdio-dom-event",
        sequence: Number(sequenceText.replace(/^#/, "")),
        type,
        ...(blockId ? { blockId } : {}),
        data: summary ? JSON.parse(summary) : {},
      } as RuntimeEvent;
    },
  );
}

export function installWdioHooks(): void {
  const hook: WdioSpikeTestHook = {
    getBlockCount: () => mainWorkspace().getAllBlocks(false).length,
    loadHundredBlockFixture: () => clickButton("载入100块"),
    getCanonicalSnapshot: () => {
      const projection = buildEditorProjection(
        Blockly.serialization.workspaces.save(mainWorkspace()),
      );
      return createSpikeProjectSnapshot({
        projectId: "windows-core-spike",
        workspace: projection.workspace,
        program: projection.program,
        interactionManifest: projection.interactionManifest,
      });
    },
    getManifest: () => {
      const projection = buildEditorProjection(
        Blockly.serialization.workspaces.save(mainWorkspace()),
      );
      return projection.interactionManifest;
    },
    startSimulation: (input) => {
      const textArea = document.querySelector<HTMLTextAreaElement>(
        "[data-testid='runtime-text-input']",
      );
      if (!textArea) throw new Error("WDIO_RUNTIME_INPUT_UNAVAILABLE");
      setControlledTextAreaValue(textArea, input);
      clickButton("发送");
    },
    cancelSimulation: () => clickButton("取消运行"),
    readRedactedEvents: readTimelineEvents,
    readUsedJsHeapSize: () => {
      const memory = (
        performance as Performance & { memory?: { usedJSHeapSize?: number } }
      ).memory;
      return Number.isFinite(memory?.usedJSHeapSize)
        ? (memory?.usedJSHeapSize ?? null)
        : null;
    },
  };
  window.__BLOCKY_SPIKE_TEST__ = Object.freeze(hook);
}
