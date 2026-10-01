import { knowledgeStages } from "@blocky/knowledge-core";
import { validateResource } from "@blocky/resource-registry";
import type { Adapters, Citation } from "./adapters";
import type { AgentServices } from "./agent-context";
import {
  rpaPlanSchema,
  rpaBrowserStartSchema,
  type RpaModuleHandle,
  type RpaModulePlan,
  type RpaStep,
} from "@blocky/rpa-core";
import { canonicalJson, stableId } from "@blocky/language-schema";
import { workflowJson, workflowKeys } from "./workflow/protocol";
const invalid = () => Error("BLK-RUN-SERVICE");
const sourceId = (value: unknown): value is string =>
  typeof value === "string" && stableId.test(value);
function rpaInput(value: unknown, projectId: string): RpaModulePlan {
  try {
    workflowKeys(value, ["plan", "inputSources"], ["browser"]);
    const plan = rpaPlanSchema.parse(value.plan);
    const browser =
      value.browser === undefined
        ? undefined
        : rpaBrowserStartSchema.parse(value.browser);
    if (
      (plan.target.kind === "browser") !== Boolean(browser) ||
      (browser &&
        (browser.projectId !== projectId ||
          new URL(browser.url).origin !== plan.target.identity))
    )
      throw invalid();
    const fill = plan.steps.filter((step) => step.action === "fill");
    workflowKeys(
      value.inputSources,
      fill.map((step) => step.stepId),
    );
    for (const step of fill) {
      const source = value.inputSources[step.stepId];
      if (
        !["manual", "input", "result"].includes(String(source)) ||
        step.value?.kind !== "manual-input" ||
        (step.value.sensitive && source !== "manual")
      )
        throw invalid();
    }
    return {
      plan,
      inputSources: value.inputSources as RpaModulePlan["inputSources"],
      ...(browser ? { browser } : {}),
    };
  } catch {
    throw invalid();
  }
}
const methods = {
  "knowledge.operation": ["input"],
  "knowledge.query": ["question", "collection", "context"],
  "agent.generate": ["input"],
  "agent.memory": ["input"],
  "agent.tool": ["input"],
  "agent.validate-citations": ["projectId", "citations"],
  "agent.close": [],
  "rpa.open": ["input"],
  "rpa.perform": ["handle", "step"],
  "rpa.close": ["handle"],
  "rpa.input": ["source"],
} as const;
function bounded<T>(promise: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(invalid()), 10000);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
/** Per-run gateway; existing adapters retain all native authorization and grant ownership. */
export class RuntimeServiceHost {
  private abort = new AbortController();
  private handles = new Map<
    string,
    { port: RpaModuleHandle; request: RpaModulePlan; closing?: Promise<void> }
  >();
  private pending = new Set<Promise<unknown>>();
  private closing?: Promise<void>;
  private closed = false;
  private agentClosed = false;
  private openingRpa = false;
  constructor(
    private projectId: string,
    private adapters: Adapters,
  ) {}
  cancel() {
    this.abort.abort();
  }
  private async closeHandle(id: string): Promise<void> {
    const handle = this.handles.get(id);
    if (!handle) throw invalid();
    handle.closing ??= Promise.resolve().then(() => handle.port.close());
    await bounded(handle.closing);
    this.handles.delete(id);
  }
  async request(input: unknown, signal: AbortSignal): Promise<unknown> {
    if (this.closed) throw invalid();
    let value: Record<string, unknown>;
    try {
      value = workflowJson(input, 20 * 1024 * 1024, 2000000, 256) as Record<
        string,
        unknown
      >;
      if (
        !value ||
        typeof value.service !== "string" ||
        !Object.hasOwn(methods, value.service)
      )
        throw invalid();
      workflowKeys(
        value,
        ["service", ...methods[value.service as keyof typeof methods]],
        value.service === "rpa.perform" ? ["input"] : [],
      );
    } catch {
      throw invalid();
    }
    const settlement =
      value.service === "agent.close" || value.service === "rpa.close";
    if (this.agentClosed && !settlement) throw invalid();
    if (signal.aborted) this.cancel();
    if (this.abort.signal.aborted && !settlement) throw invalid();
    const cancel = () => this.cancel();
    signal.addEventListener("abort", cancel, { once: true });
    const promise = this.dispatch(value);
    this.pending.add(promise);
    try {
      return (await promise) ?? null;
    } finally {
      signal.removeEventListener("abort", cancel);
      this.pending.delete(promise);
    }
  }
  private async dispatch(v: Record<string, unknown>): Promise<unknown> {
    const signal = this.abort.signal;
    const project = (value: unknown) => {
      if (
        !value ||
        typeof value !== "object" ||
        (value as { projectId?: unknown }).projectId !== this.projectId
      )
        throw invalid();
    };
    switch (v.service) {
      case "knowledge.operation": {
        project(v.input);
        try {
          workflowKeys(v.input, ["projectId", "resource", "stage", "options"]);
        } catch {
          throw invalid();
        }
        const request = v.input as Parameters<
          NonNullable<Adapters["knowledgeOperation"]>
        >[0];
        const resource = validateResource(request.resource);
        if (
          resource.kind !== "knowledge" ||
          !knowledgeStages.includes(request.stage) ||
          !this.adapters.knowledgeOperation
        )
          throw invalid();
        return this.adapters.knowledgeOperation(
          { ...request, resource },
          signal,
        );
      }
      case "knowledge.query": {
        project(v.context);
        const method = this.adapters.knowledge.get(
          "adapter://knowledge-local-v1",
        );
        if (
          !method ||
          typeof v.question !== "string" ||
          typeof v.collection !== "string"
        )
          throw invalid();
        return method(
          v.question,
          v.collection,
          signal,
          v.context as Parameters<typeof method>[3],
        );
      }
      case "agent.generate":
      case "agent.memory":
      case "agent.tool": {
        project(v.input);
        const key = String(v.service).split(".")[1] as
          | "generate"
          | "memory"
          | "tool";
        const method = this.adapters.agent?.[key];
        if (!method) throw invalid();
        return method(
          v.input as Parameters<NonNullable<AgentServices["generate"]>>[0] &
            Parameters<NonNullable<AgentServices["memory"]>>[0] &
            Parameters<NonNullable<AgentServices["tool"]>>[0],
          signal,
        );
      }
      case "agent.validate-citations":
        if (v.projectId !== this.projectId || !Array.isArray(v.citations))
          throw invalid();
        return this.adapters.agent?.validateCitations?.(
          this.projectId,
          v.citations as Citation[],
          signal,
        );
      case "agent.close":
        if (!this.agentClosed) {
          await this.adapters.agent?.close?.(signal);
          this.agentClosed = true;
        }
        return;
      case "rpa.input": {
        try {
          workflowKeys(v.source, ["moduleId", "blockId"]);
        } catch {
          throw invalid();
        }
        const source = v.source as { moduleId: unknown; blockId: unknown };
        if (
          !sourceId(source.moduleId) ||
          !sourceId(source.blockId) ||
          ![...this.handles.values()].some(
            (handle) =>
              handle.request.inputSources[source.blockId as string] ===
              "manual",
          )
        )
          throw invalid();
        const method = this.adapters.rpa?.manualInput;
        if (!method) throw invalid();
        return method(
          v.source as { moduleId: string; blockId: string },
          signal,
        );
      }
      case "rpa.open": {
        if (this.handles.size || this.openingRpa || !this.adapters.rpa)
          throw invalid();
        const input = rpaInput(v.input, this.projectId);
        this.openingRpa = true;
        try {
          const handle = await this.adapters.rpa.open(input, signal),
            id = `rpa-${crypto.randomUUID()}`;
          this.handles.set(id, { port: handle, request: input });
          if (this.closed || signal.aborted) {
            await this.closeHandle(id);
            throw invalid();
          }
          return { handle: id, checkpointId: handle.checkpointId };
        } finally {
          this.openingRpa = false;
        }
      }
      case "rpa.perform":
      case "rpa.close": {
        const handle =
          typeof v.handle === "string" ? this.handles.get(v.handle) : undefined;
        if (!handle) throw invalid();
        if (v.service === "rpa.close") {
          await this.closeHandle(v.handle as string);
          return;
        }
        if (handle.closing) throw invalid();
        const step = handle.request.plan.steps.find(
          (step) => step.stepId === (v.step as RpaStep | undefined)?.stepId,
        );
        if (!step || canonicalJson(v.step) !== canonicalJson(step))
          throw invalid();
        if (
          step.action === "fill"
            ? typeof v.input !== "string" ||
              new TextEncoder().encode(v.input).length > 16384 ||
              v.input.includes("\0")
            : v.input !== undefined
        )
          throw invalid();
        return handle.port.perform(step, v.input as string | undefined, signal);
      }
      default:
        throw invalid();
    }
  }
  close(): Promise<void> {
    return (this.closing ??= (async () => {
      this.closed = true;
      this.cancel();
      await bounded(Promise.allSettled([...this.pending]));
      for (const id of this.handles.keys()) await this.closeHandle(id);
      if (!this.agentClosed) {
        await bounded(
          Promise.resolve(this.adapters.agent?.close?.(this.abort.signal)),
        );
        this.agentClosed = true;
      }
    })());
  }
}
