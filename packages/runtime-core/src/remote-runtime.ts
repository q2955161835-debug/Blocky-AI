import { stableId, type Resource } from "@blocky/language-schema";
import { parseProject } from "@blocky/project-model";
import { validateResource } from "@blocky/resource-registry";
import type { RuntimeEvent } from "@blocky/observability";
import { readRpaResult } from "@blocky/rpa-core";
import { Runtime, type RunResult } from "./runtime";
import { localAdapters, type Adapters } from "./adapters";
import type { AgentServices } from "./agent-context";
import type { WorkflowPorts } from "./workflow/runtime";
import { workflowJson, workflowKeys } from "./workflow/protocol";
export type RuntimeServiceCall = (
  request: Record<string, unknown>,
  signal: AbortSignal,
) => Promise<unknown>;
const invalid = () => Error("BLK-RUN-STATE");
const id = (v: unknown): v is string =>
  typeof v === "string" && stableId.test(v);
function parse(input: unknown) {
  try {
    // The private state is a JSON string so native framing does not impose a lower payload depth.
    const value = workflowJson(input, 20 * 1024 * 1024, 2000000, 256);
    workflowKeys(
      value,
      ["schemaVersion", "project", "interactionId", "question", "options"],
      ["state"],
    );
    if (
      value.schemaVersion !== "blocky.desktop-run/v1" ||
      !id(value.interactionId) ||
      typeof value.question !== "string" ||
      new TextEncoder().encode(value.question).length > 16000
    )
      throw invalid();
    const project = parseProject(value.project);
    workflowKeys(
      value.options,
      [],
      ["moduleId", "debug", "userRegistry", "workflowTaskId"],
    );
    const options = value.options;
    for (const key of ["moduleId", "workflowTaskId"])
      if (options[key] !== undefined && !id(options[key])) throw invalid();
    if (
      typeof options.workflowTaskId === "string" &&
      options.workflowTaskId.length > 128
    )
      throw invalid();
    let debug:
      | {
          breakpoints?: { moduleId: string; blockId: string }[];
          startBlockId?: string;
        }
      | undefined;
    if (options.debug !== undefined) {
      workflowKeys(options.debug, [], ["breakpoints", "startBlockId"]);
      const raw = options.debug;
      if (raw.startBlockId !== undefined && !id(raw.startBlockId))
        throw invalid();
      if (raw.breakpoints !== undefined) {
        if (!Array.isArray(raw.breakpoints)) throw invalid();
        for (const point of raw.breakpoints) {
          workflowKeys(point, ["moduleId", "blockId"]);
          if (!id(point.moduleId) || !id(point.blockId)) throw invalid();
        }
      }
      debug = raw as typeof debug;
    }
    const registry = new Map<string, Resource>();
    if (options.userRegistry !== undefined) {
      if (!Array.isArray(options.userRegistry)) throw invalid();
      for (const item of options.userRegistry) {
        const resource = validateResource(item);
        if (resource.scope !== "user" || registry.has(resource.resourceId))
          throw invalid();
        registry.set(resource.resourceId, resource);
      }
    }
    let state: unknown;
    if (value.state !== undefined) {
      if (
        typeof value.state !== "string" ||
        new TextEncoder().encode(value.state).length > 2 * 1024 * 1024
      )
        throw invalid();
      state = JSON.parse(value.state);
    }
    return {
      project,
      interactionId: value.interactionId,
      question: value.question,
      state,
      options: {
        moduleId: options.moduleId as string | undefined,
        workflowTaskId: options.workflowTaskId as string | undefined,
        debug,
        userRegistry: registry,
      },
    };
  } catch {
    throw invalid();
  }
}
/** Same Runtime, with a closed semantic-service boundary. No native paths, keys or arbitrary invoke. */
export class RemoteRuntime {
  private current?: Runtime;
  constructor(
    private call: RuntimeServiceCall,
    private workflow?: WorkflowPorts,
    private delayMs = 0,
  ) {}
  control(action: "pause" | "resume" | "step") {
    this.current?.[action]();
  }
  async run(
    input: unknown,
    signal: AbortSignal,
    onEvent: (event: RuntimeEvent) => void,
  ): Promise<{ result: RunResult; state: string }> {
    if (this.current) throw Error("BLK-RUN-003");
    const request = parse(input),
      adapters = localAdapters();
    const service = (
      service: string,
      fields: Record<string, unknown>,
      operationSignal = signal,
    ) => this.call({ service, ...fields }, operationSignal);
    adapters.knowledge.set(
      "adapter://knowledge-local-v1",
      (question, collection, operationSignal, context) =>
        service(
          "knowledge.query",
          { question, collection, context },
          operationSignal,
        ) as ReturnType<NonNullable<ReturnType<Adapters["knowledge"]["get"]>>>,
    );
    adapters.knowledgeOperation = (input, signal) =>
      service("knowledge.operation", { input }, signal) as ReturnType<
        NonNullable<Adapters["knowledgeOperation"]>
      >;
    const agent: AgentServices = {
      generate: (input, signal) =>
        service("agent.generate", { input }, signal) as ReturnType<
          NonNullable<AgentServices["generate"]>
        >,
      memory: (input, signal) =>
        service("agent.memory", { input }, signal) as ReturnType<
          NonNullable<AgentServices["memory"]>
        >,
      tool: (input, signal) =>
        service("agent.tool", { input }, signal) as ReturnType<
          NonNullable<AgentServices["tool"]>
        >,
      validateCitations: async (projectId, citations, signal) => {
        await service(
          "agent.validate-citations",
          { projectId, citations },
          signal,
        );
      },
      close: async (signal) => {
        await service("agent.close", {}, signal);
      },
    };
    adapters.agent = agent;
    adapters.workflow = this.workflow;
    adapters.rpa = {
      manualInput: async (source, signal) => {
        const value = await service("rpa.input", { source }, signal);
        if (typeof value !== "string") throw Error("BLK-RPA-CANCELLED");
        return value;
      },
      open: async (input, signal) => {
        const value = (await service("rpa.open", { input }, signal)) as {
          handle?: unknown;
          checkpointId?: unknown;
        };
        if (
          !value ||
          !id(value.handle) ||
          typeof value.checkpointId !== "string"
        )
          throw Error("BLK-RUN-SERVICE");
        const handle = value.handle;
        let closed = false;
        return {
          checkpointId: value.checkpointId,
          perform: async (step, input, signal) => {
            if (closed) throw Error("BLK-RUN-SERVICE");
            return readRpaResult(
              await service(
                "rpa.perform",
                { handle, step, ...(input === undefined ? {} : { input }) },
                signal,
              ),
            );
          },
          close: async () => {
            if (!closed) {
              await service("rpa.close", { handle });
              closed = true;
            }
          },
        };
      },
    };
    const runtime = new Runtime({
      adapters,
      sessionState: request.state,
      delayMs: this.delayMs,
    });
    this.current = runtime;
    try {
      const result = await runtime.run(
        request.project,
        request.interactionId,
        request.question,
        { ...request.options, signal, onEvent },
      );
      return { result, state: JSON.stringify(runtime.captureSession()) };
    } finally {
      this.current = undefined;
    }
  }
}
