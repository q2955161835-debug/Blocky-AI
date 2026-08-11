import * as Blockly from "blockly/core";
import { buildEditorProjection } from "../blockly/BlocklyCanvas";
import { createHundredBlockWorkspaceState } from "../blockly/fixtures";
import { createDeterministicModel, runProgram } from "../core/deterministicRuntime";
import type { InteractionManifest } from "../core/interactionManifest";
import type { IrNode } from "../core/ir";
import { stableStringify } from "../core/json";
import type { RuntimeEvent } from "../core/runtimeEvents";
import { createSpikeProjectSnapshot, type SpikeProjectSnapshot } from "../project/SpikeProjectSnapshot";

interface OperationMetric {
  readonly samplesMs: readonly number[];
  readonly medianMs: number;
  readonly observedBlockCounts: readonly number[];
  readonly observedNodeCounts: readonly number[];
}

interface PerformanceMetrics {
  readonly schemaVersion: "blocky.performance/v0-spike";
  readonly environment: {
    readonly userAgent: string;
    readonly hardwareConcurrency: number;
  };
  readonly load: OperationMetric;
  readonly saveCompile: OperationMetric;
  readonly runtime: OperationMetric;
}

interface SoakPreparation {
  readonly baselineSnapshotJson: string;
  readonly baselineSha256: string;
  readonly blockCount: number;
}

interface SoakCycleResult {
  readonly cycle: number;
  readonly blockCount: number;
  readonly nodeCount: number;
  readonly snapshotJson: string;
  readonly snapshotSha256: string;
  readonly compileErrorCount: number;
  readonly terminalTypes: readonly string[];
  readonly eventRowCount: number;
  readonly uncaughtErrors: readonly string[];
  readonly unhandledRejections: readonly string[];
  readonly outboundAttempts: readonly string[];
  readonly jsonRoundTripValid: boolean;
}

interface WdioSpikeTestHook {
  getBlockCount(): number;
  loadHundredBlockFixture(): Promise<void>;
  loadVisualAcceptanceWorkspace(): void;
  readWorkspaceViewState(): WorkspaceViewState;
  readTopLevelOverlapPairs(): readonly string[];
  getCanonicalSnapshot(): SpikeProjectSnapshot;
  getManifest(): InteractionManifest;
  startSimulation(input: string): void;
  cancelSimulation(): void;
  readRedactedEvents(): RuntimeEvent[];
  readUsedJsHeapSize(): number | null;
  measureCorePerformance(): Promise<PerformanceMetrics>;
  prepareSoak(): Promise<SoakPreparation>;
  runSoakCycle(cycle: number): Promise<SoakCycleResult>;
}

interface WorkspaceViewState {
  readonly scale: number;
  readonly scrollX: number;
  readonly scrollY: number;
  readonly topBlocks: readonly {
    readonly id: string;
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  }[];
}

declare global {
  interface Window {
    __BLOCKY_SPIKE_TEST__?: WdioSpikeTestHook;
  }
}

function mainWorkspace(): Blockly.WorkspaceSvg {
  const workspace = Blockly.getMainWorkspace();
  if (!(workspace instanceof Blockly.WorkspaceSvg)) {
    throw new Error("WDIO_WORKSPACE_UNAVAILABLE");
  }
  return workspace;
}

function clickButton(name: string): void {
  const button = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (candidate) =>
      candidate.getAttribute("aria-label") === name ||
      candidate.textContent?.trim() === name,
  );
  if (!button) throw new Error(`WDIO_BUTTON_UNAVAILABLE:${name}`);
  button.click();
}

async function clickMenuAction(menuName: string, actionName: string): Promise<void> {
  clickButton(menuName);
  await waitFor(() => [...document.querySelectorAll<HTMLButtonElement>(
    'button[role="menuitem"]',
  )].some((candidate) => candidate.textContent?.trim() === actionName));
  clickButton(actionName);
}

function readWorkspaceViewState(): WorkspaceViewState {
  const workspace = mainWorkspace();
  return {
    scale: workspace.scale,
    scrollX: workspace.scrollX,
    scrollY: workspace.scrollY,
    topBlocks: [...workspace.getTopBlocks(true)]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((block) => {
        const bounds = block.getBoundingRectangle();
        return {
          id: block.id,
          x: bounds.left,
          y: bounds.top,
          width: bounds.right - bounds.left,
          height: bounds.bottom - bounds.top,
        };
      }),
  };
}

function readTopLevelOverlapPairs(): readonly string[] {
  const blocks = readWorkspaceViewState().topBlocks;
  const overlaps: string[] = [];
  for (let leftIndex = 0; leftIndex < blocks.length; leftIndex += 1) {
    const left = blocks[leftIndex];
    if (!left) continue;
    for (let rightIndex = leftIndex + 1; rightIndex < blocks.length; rightIndex += 1) {
      const right = blocks[rightIndex];
      if (!right) continue;
      const separated =
        left.x + left.width <= right.x ||
        right.x + right.width <= left.x ||
        left.y + left.height <= right.y ||
        right.y + right.height <= left.y;
      if (!separated) overlaps.push(`${left.id}|${right.id}`);
    }
  }
  return overlaps;
}

function loadVisualAcceptanceWorkspace(): void {
  const workspace = mainWorkspace();
  const metrics = workspace.getMetrics();
  const x = metrics.viewLeft + Math.max(120, metrics.viewWidth * 0.18);
  const y = metrics.viewTop + 150;
  const state = {
    blocks: {
      languageVersion: 0,
      blocks: [
        {
          type: "core.agent.define",
          id: "block-001",
          x,
          y,
          fields: { NAME: "Weather assistant" },
        },
        {
          type: "core.interaction.chat_entry",
          id: "block-002",
          x: x + 24,
          y: y + 170,
          fields: { NAME: "Chat" },
        },
        {
          type: "core.tool.call",
          id: "block-043",
          x: x + 48,
          y: y + 340,
        },
      ],
    },
  };
  Blockly.Events.disable();
  try {
    workspace.clear();
    Blockly.serialization.workspaces.load(state, workspace);
  } finally {
    Blockly.Events.enable();
  }
  workspace.fireChangeListener(new Blockly.Events.FinishedLoading(workspace));
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
      const sequenceText = item.querySelector(
        ".event-timeline__sequence",
      )?.textContent;
      const type = item.querySelector(".event-timeline__meta strong")?.textContent;
      const blockId = item.querySelector(".event-timeline__meta code")?.textContent;
      const summary = item.querySelector(".event-timeline__summary")?.textContent;
      const eventVersion = item.dataset.eventVersion;
      const runId = item.dataset.runId;
      if (eventVersion !== "blocky.event/v0-spike" || !runId || !sequenceText || !type) {
        throw new Error("WDIO_EVENT_DOM_INVALID");
      }
      return {
        eventVersion,
        runId,
        sequence: Number(sequenceText.replace(/^#/, "")),
        type,
        ...(blockId ? { blockId } : {}),
        data: summary ? JSON.parse(summary) : {},
      } as RuntimeEvent;
    },
  );
}

function countProgramNodes(roots: readonly IrNode[]): number {
  const visit = (node: IrNode): number =>
    1 +
    Object.values(node.inputs).reduce(
      (total, child) => total + (child ? visit(child) : 0),
      0,
    ) +
    (node.next ? visit(node.next) : 0);
  return roots.reduce((total, root) => total + visit(root), 0);
}

function median(samples: readonly number[]): number {
  const sorted = [...samples].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? Number.NaN;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function measureOperation(
  operation: () => Promise<{
    blockCount: number;
    nodeCount: number;
    elapsedMs?: number;
  }>,
): Promise<OperationMetric> {
  await operation();
  const samplesMs: number[] = [];
  const observedBlockCounts: number[] = [];
  const observedNodeCounts: number[] = [];
  for (let index = 0; index < 5; index += 1) {
    const startedAt = performance.now();
    const observation = await operation();
    samplesMs.push(observation.elapsedMs ?? performance.now() - startedAt);
    observedBlockCounts.push(observation.blockCount);
    observedNodeCounts.push(observation.nodeCount);
  }
  return {
    samplesMs,
    medianMs: median(samplesMs),
    observedBlockCounts,
    observedNodeCounts,
  };
}

async function measureCorePerformance(): Promise<PerformanceMetrics> {
  const workspace = mainWorkspace();
  const fixture = createHundredBlockWorkspaceState();
  const load = await measureOperation(async () => {
    Blockly.Events.disable();
    const startedAt = performance.now();
    try {
      workspace.clear();
      Blockly.serialization.workspaces.load(fixture, workspace);
    } finally {
      Blockly.Events.enable();
    }
    const elapsedMs = performance.now() - startedAt;
    const projection = buildEditorProjection(
      Blockly.serialization.workspaces.save(workspace),
    );
    return {
      blockCount: workspace.getAllBlocks(false).length,
      nodeCount: countProgramNodes(projection.program.roots),
      elapsedMs,
    };
  });

  const saveCompile = await measureOperation(async () => {
    const workspaceState = Blockly.serialization.workspaces.save(workspace);
    const projection = buildEditorProjection(workspaceState);
    return {
      blockCount: workspace.getAllBlocks(false).length,
      nodeCount: countProgramNodes(projection.program.roots),
    };
  });

  const projection = buildEditorProjection(
    Blockly.serialization.workspaces.save(workspace),
  );
  const runtime = await measureOperation(async () => {
    const events: RuntimeEvent[] = [];
    await runProgram({
      program: projection.program,
      sourceMap: { ...projection.sourceMap },
      input: "performance",
      signal: new AbortController().signal,
      dependencies: {
        runIdFactory: () => "performance-run",
        model: createDeterministicModel(),
        tools: new Map(
          projection.toolContracts.map((contract) => [contract.id, contract]),
        ),
        requestApproval: async () => "approved",
      },
      onEvent: (event) => events.push(event),
    });
    const terminalEvents = events.filter((event) =>
      event.type === "run.completed" ||
      event.type === "run.cancelled" ||
      event.type === "run.failed",
    );
    if (terminalEvents.length !== 1 || terminalEvents[0]?.type !== "run.completed") {
      throw new Error("WDIO_PERFORMANCE_RUNTIME_TERMINAL_INVALID");
    }
    return {
      blockCount: workspace.getAllBlocks(false).length,
      nodeCount: countProgramNodes(projection.program.roots),
    };
  });

  return {
    schemaVersion: "blocky.performance/v0-spike",
    environment: {
      userAgent: navigator.userAgent,
      hardwareConcurrency: navigator.hardwareConcurrency,
    },
    load,
    saveCompile,
    runtime,
  };
}

const soakEvidence = {
  prepared: false,
  uncaughtErrors: [] as string[],
  unhandledRejections: [] as string[],
  outboundAttempts: [] as string[],
  listenersInstalled: false,
  networkGuardInstalled: false,
};

function installSoakEvidenceCollectors(): void {
  soakEvidence.uncaughtErrors.length = 0;
  soakEvidence.unhandledRejections.length = 0;
  soakEvidence.outboundAttempts.length = 0;
  if (!soakEvidence.listenersInstalled) {
    window.addEventListener("error", (event) => {
      soakEvidence.uncaughtErrors.push(event.error?.name ?? "ErrorEvent");
    });
    window.addEventListener("unhandledrejection", (event) => {
      const reason = event.reason;
      soakEvidence.unhandledRejections.push(
        reason instanceof Error ? reason.name : typeof reason,
      );
    });
    soakEvidence.listenersInstalled = true;
  }
  if (soakEvidence.networkGuardInstalled) return;
  const originalFetch = window.fetch.bind(window);
  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
    const parsed = new URL(raw, window.location.href);
    if (parsed.protocol === "http:" && parsed.host === "ipc.localhost") {
      return originalFetch(input, init);
    }
    soakEvidence.outboundAttempts.push(`${parsed.protocol}//${parsed.host}`);
    throw new Error("OUTBOUND_FETCH_BLOCKED");
  }) as typeof window.fetch;
  window.XMLHttpRequest = class BlockedXmlHttpRequest {
    constructor() {
      soakEvidence.outboundAttempts.push("xhr://constructor");
      throw new Error("OUTBOUND_XHR_BLOCKED");
    }
  } as unknown as typeof window.XMLHttpRequest;
  window.WebSocket = class BlockedWebSocket {
    constructor() {
      soakEvidence.outboundAttempts.push("websocket://constructor");
      throw new Error("OUTBOUND_WEBSOCKET_BLOCKED");
    }
  } as unknown as typeof window.WebSocket;
  soakEvidence.networkGuardInstalled = true;
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 15_000,
): Promise<void> {
  const startedAt = performance.now();
  while (!predicate()) {
    if (performance.now() - startedAt >= timeoutMs) {
      throw new Error("WDIO_SOAK_WAIT_TIMEOUT");
    }
    await new Promise((resolve) => window.setTimeout(resolve, 25));
  }
}

function latestRunEvents(): RuntimeEvent[] {
  const events = readTimelineEvents();
  let start = -1;
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index]?.type === "run.started") {
      start = index;
      break;
    }
  }
  return start < 0 ? [] : events.slice(start);
}

async function canonicalSoakSnapshot(): Promise<{
  json: string;
  sha256: string;
  blockCount: number;
  nodeCount: number;
  compileErrorCount: number;
}> {
  const workspace = mainWorkspace();
  const projection = buildEditorProjection(
    Blockly.serialization.workspaces.save(workspace),
  );
  const snapshot = createSpikeProjectSnapshot({
    projectId: "windows-core-soak",
    workspace: projection.workspace,
    program: projection.program,
    interactionManifest: projection.interactionManifest,
  });
  const json = stableStringify(snapshot);
  return {
    json,
    sha256: await sha256Hex(json),
    blockCount: workspace.getAllBlocks(false).length,
    nodeCount: countProgramNodes(projection.program.roots),
    compileErrorCount: projection.diagnostics.filter(
      (diagnostic) => diagnostic.severity === "error",
    ).length,
  };
}

async function prepareSoak(): Promise<SoakPreparation> {
  installSoakEvidenceCollectors();
  await clickMenuAction("视图", "载入100块");
  await waitFor(() => mainWorkspace().getAllBlocks(false).length === 100);
  mainWorkspace().getBlockById("block-001")?.setCollapsed(false);
  const baseline = await canonicalSoakSnapshot();
  if (baseline.blockCount !== 100 || baseline.nodeCount !== 100) {
    throw new Error("WDIO_SOAK_BASELINE_COUNT_INVALID");
  }
  soakEvidence.prepared = true;
  return {
    baselineSnapshotJson: baseline.json,
    baselineSha256: baseline.sha256,
    blockCount: baseline.blockCount,
  };
}

async function runSoakCycle(cycle: number): Promise<SoakCycleResult> {
  if (!soakEvidence.prepared || !Number.isInteger(cycle) || cycle < 1) {
    throw new Error("WDIO_SOAK_NOT_PREPARED");
  }
  const firstBlock = mainWorkspace().getBlockById("block-001");
  if (!firstBlock) throw new Error("WDIO_SOAK_COLLAPSE_BLOCK_UNAVAILABLE");
  firstBlock.setCollapsed(cycle % 2 === 1);
  const snapshot = await canonicalSoakSnapshot();

  const input = `soak-${cycle}`;
  const textArea = document.querySelector<HTMLTextAreaElement>(
    "[data-testid='runtime-text-input']",
  );
  if (!textArea) throw new Error("WDIO_SOAK_RUNTIME_INPUT_UNAVAILABLE");
  setControlledTextAreaValue(textArea, input);
  clickButton("发送");
  await waitFor(() => {
    const events = latestRunEvents();
    const hasInputChunk = events.some((event) => {
      const data = event.data;
      return event.type === "model.chunk" &&
        data !== null &&
        !Array.isArray(data) &&
        typeof data === "object" &&
        data.text === input;
    });
    const terminal = events.at(-1)?.type;
    return hasInputChunk && (
      terminal === "run.completed" ||
      terminal === "run.cancelled" ||
      terminal === "run.failed"
    );
  });
  const events = latestRunEvents();
  const terminalTypes = events
    .filter((event) =>
      event.type === "run.completed" ||
      event.type === "run.cancelled" ||
      event.type === "run.failed",
    )
    .map((event) => event.type);
  let jsonRoundTripValid = false;
  try {
    jsonRoundTripValid = stableStringify(JSON.parse(snapshot.json)) === snapshot.json;
  } catch {
    jsonRoundTripValid = false;
  }

  return {
    cycle,
    blockCount: snapshot.blockCount,
    nodeCount: snapshot.nodeCount,
    snapshotJson: snapshot.json,
    snapshotSha256: snapshot.sha256,
    compileErrorCount: snapshot.compileErrorCount,
    terminalTypes,
    eventRowCount: document.querySelectorAll(".event-timeline__item").length,
    uncaughtErrors: [...soakEvidence.uncaughtErrors],
    unhandledRejections: [...soakEvidence.unhandledRejections],
    outboundAttempts: [...soakEvidence.outboundAttempts],
    jsonRoundTripValid,
  };
}

export function installWdioHooks(): void {
  const hook: WdioSpikeTestHook = {
    getBlockCount: () => mainWorkspace().getAllBlocks(false).length,
    loadHundredBlockFixture: () => clickMenuAction("视图", "载入100块"),
    loadVisualAcceptanceWorkspace,
    readWorkspaceViewState,
    readTopLevelOverlapPairs,
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
    measureCorePerformance,
    prepareSoak,
    runSoakCycle,
  };
  window.__BLOCKY_SPIKE_TEST__ = Object.freeze(hook);
}
