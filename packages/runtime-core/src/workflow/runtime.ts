import {
  digest,
  workflowLayout,
  type IrNode,
  type Json,
  type Project,
  type Resource,
} from "@blocky/language-schema";
import { resolveResource } from "@blocky/resource-registry";
import type { AgentExecution } from "../agent-execution";
import { abortable, type RunBudget } from "../budget";
import type { Citation } from "../adapters";
import {
  parseAgentCheckpoint,
  parseBudgetCheckpoint,
  type AgentCheckpoint,
  type BudgetCheckpoint,
} from "./context";
import { advanceWorkflow, type WorkflowStore } from "./execute";
import {
  assertWorkflowBinding,
  parseWorkflow,
  requireWorkflow,
  workflowJson,
  workflowKeys,
  workflowSummary,
  type WorkflowDefinition,
} from "./protocol";

export interface WorkflowPorts {
  open(
    request: { definition: WorkflowDefinition; initial: Json; taskId?: string },
    signal: AbortSignal,
  ): Promise<{ taskId: string; store: WorkflowStore; close(): Promise<void> }>;
}
export type WorkflowSummary = ReturnType<typeof workflowSummary>;
type Presentation = {
  answer: string;
  citations: Citation[];
  role: string;
  style: string;
};
type Frame = {
  schemaVersion: "blocky.workflow-context/v1";
  agent: AgentCheckpoint;
  budget: BudgetCheckpoint;
  presentation: Presentation;
};
export class WorkflowWaiting extends Error {
  constructor() {
    super("BLK-WORKFLOW-WAITING");
  }
}
function frame(input: unknown): Frame {
  const value = workflowJson(input);
  workflowKeys(value, ["schemaVersion", "agent", "budget", "presentation"]);
  requireWorkflow(value.schemaVersion === "blocky.workflow-context/v1");
  parseAgentCheckpoint(value.agent);
  parseBudgetCheckpoint(value.budget);
  const p = value.presentation;
  workflowKeys(p, ["answer", "citations", "role", "style"]);
  for (const name of ["answer", "role", "style"])
    requireWorkflow(typeof p[name] === "string");
  requireWorkflow(Array.isArray(p.citations) && p.citations.length <= 20);
  for (const c of p.citations) {
    workflowKeys(
      c,
      ["id", "title", "text"],
      [
        "sourceId",
        "documentId",
        "revision",
        "digest",
        "locator",
        "score",
        "truncated",
        "collectionId",
      ],
    );
    for (const key of [
      "id",
      "title",
      "text",
      "sourceId",
      "documentId",
      "revision",
      "digest",
      "collectionId",
    ])
      if (Object.hasOwn(c, key)) requireWorkflow(typeof c[key] === "string");
    if (Object.hasOwn(c, "score"))
      requireWorkflow(typeof c.score === "number" && Number.isFinite(c.score));
    if (Object.hasOwn(c, "truncated"))
      requireWorkflow(typeof c.truncated === "boolean");
    if (Object.hasOwn(c, "locator")) {
      workflowKeys(
        c.locator,
        ["path", "lineStart", "lineEnd"],
        ["url", "commit"],
      );
      for (const key of ["path", "url", "commit"])
        if (Object.hasOwn(c.locator, key))
          requireWorkflow(typeof c.locator[key] === "string");
      requireWorkflow(
        typeof c.locator.lineStart === "number" &&
          Number.isSafeInteger(c.locator.lineStart) &&
          c.locator.lineStart >= 1 &&
          typeof c.locator.lineEnd === "number" &&
          Number.isSafeInteger(c.locator.lineEnd) &&
          c.locator.lineEnd >= c.locator.lineStart,
      );
    }
  }
  return value as unknown as Frame;
}
/** A run-local bridge into the same Runtime child-stack evaluator, not a second interpreter. */
export class WorkflowExecution {
  result?: WorkflowSummary;
  private used = false;
  constructor(
    private ports: WorkflowPorts | undefined,
    private project: Project,
    private registry: Map<string, Resource> | undefined,
    private agent: AgentExecution,
    private budget: RunBudget,
    private presentation: () => Presentation,
    private restorePresentation: (value: Presentation) => void,
    private report: (value: WorkflowSummary) => void,
  ) {}
  private capture(): Json {
    return frame({
      schemaVersion: "blocky.workflow-context/v1",
      agent: this.agent.checkpoint(),
      budget: this.budget.checkpoint(),
      presentation: this.presentation(),
    }) as unknown as Json;
  }
  async execute(
    node: IrNode,
    moduleId: string,
    execute: (child: IrNode) => Promise<void>,
    taskId?: string,
  ): Promise<void> {
    requireWorkflow(!this.used, "BLK-WORKFLOW-SCOPE");
    this.used = true;
    requireWorkflow(this.ports, "BLK-WORKFLOW-PORT");
    const signal = this.budget.signal;
    signal.throwIfAborted();
    const layout = workflowLayout(node);
    const resources = this.project.manifest.resources.map((r) =>
      resolveResource(this.project, r.resourceId, r.kind, this.registry),
    );
    const definition: WorkflowDefinition = {
      projectId: this.project.manifest.projectId,
      moduleId,
      blockId: node.nodeId,
      runtimeVersion: 1,
      planDigest: await digest({ project: this.project, resources }),
      steps: layout.map((step) =>
        step.kind === "action"
          ? {
              stepId: step.stepId,
              kind: step.kind,
              compensate: step.compensate,
            }
          : step,
      ),
    };
    signal.throwIfAborted();
    const handle = await this.ports.open(
      {
        definition: structuredClone(definition),
        initial: this.capture(),
        ...(taskId ? { taskId } : {}),
      },
      signal,
    );
    try {
      const saved = parseWorkflow(await handle.store.read(handle.taskId));
      assertWorkflowBinding(saved, handle.taskId, definition);
      requireWorkflow(
        !taskId || taskId === handle.taskId,
        "BLK-WORKFLOW-BINDING",
      );
      this.result = workflowSummary(saved);
      requireWorkflow(
        !["executing", "undoing", "uncertain"].includes(saved.status),
        "BLK-WORKFLOW-UNCERTAIN",
      );
      const restored = frame(saved.state);
      if (restored.presentation.citations.some((c) => c.collectionId)) {
        requireWorkflow(
          this.agent.services.validateCitations,
          "BLK-WORKFLOW-PORT",
        );
        await abortable(
          this.agent.services.validateCitations(
            this.project.manifest.projectId,
            restored.presentation.citations,
            signal,
          ),
          signal,
        );
      }
      signal.throwIfAborted();
      if (["completed", "compensated"].includes(saved.status)) {
        this.agent.restoreCompletedOutput(restored.agent);
        this.restorePresentation(restored.presentation);
        return;
      }
      this.budget.restoreCheckpoint(restored.budget);
      this.agent.restoreCheckpoint(restored.agent);
      this.restorePresentation(restored.presentation);
      const result = await advanceWorkflow(
        handle.store,
        handle.taskId,
        definition,
        {
          execute: async (step) => {
            const entry = layout.find((s) => s.stepId === step.stepId);
            requireWorkflow(entry?.kind === "action");
            await execute(entry.body);
            return this.capture();
          },
          compensate: async (step, context) => {
            const entry = layout.find((s) => s.stepId === step.stepId);
            requireWorkflow(entry?.kind === "action" && entry.undo);
            const before = frame(context.before),
              after = frame(context.after);
            this.agent.value = {
              before: before.agent.value,
              after: after.agent.value,
              current: this.agent.value,
            };
            await execute(entry.undo);
            return this.capture();
          },
        },
        signal,
        (record) => {
          this.result = workflowSummary(record);
          this.report(this.result);
        },
      );
      this.result = workflowSummary(result);
      if (result.status === "uncertain") throw Error("BLK-WORKFLOW-UNCERTAIN");
      if (result.status === "paused" || result.status === "awaiting-approval")
        throw new WorkflowWaiting();
    } finally {
      await handle.close();
    }
  }
}
