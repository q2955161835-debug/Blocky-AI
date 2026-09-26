import {
  compileRpaSession,
  isRpaSession,
  isRpaStep,
  readRpaResult,
  type RpaModuleHandle,
  type RpaModulePlan,
  type RpaModulePorts,
} from "@blocky/rpa-core";
import type { IrNode, Json } from "@blocky/language-schema";
import type { TraceDetails } from "@blocky/observability";

/** Native handles stay run-local; only source-linked, content-free metadata is reported. */
export class RpaExecution {
  private active?: {
    moduleId: string;
    request: RpaModulePlan;
    handle: RpaModuleHandle;
  };
  constructor(
    private ports: RpaModulePorts | undefined,
    private projectId: string,
    private signal: AbortSignal,
  ) {}
  async execute(
    node: IrNode,
    moduleId: string,
    state: { value: Json; question: string },
    execute: (child: IrNode) => Promise<void>,
    report: (detail: TraceDetails) => void,
  ): Promise<boolean> {
    if (!isRpaSession(node.blockType) && !isRpaStep(node.blockType))
      return false;
    this.signal.throwIfAborted();
    if (!this.ports) throw Error("BLK-RPA-PORT-001");
    if (isRpaSession(node.blockType)) {
      if (this.active) throw Error("BLK-RPA-SCOPE-001");
      const request = compileRpaSession(node, this.projectId);
      const handle = await this.ports.open(request, this.signal);
      try {
        if (
          !/^checkpoint-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(handle.checkpointId) ||
          handle.checkpointId.length > 80
        )
          throw Error("BLK-RPA-JOURNAL-001");
        this.active = { moduleId, request, handle };
        report({
          rpa: {
            targetKind: request.plan.target.kind,
            phase: "authorized",
            checkpointId: handle.checkpointId,
          },
        });
        this.signal.throwIfAborted();
        await execute(node.inputs.STEPS as IrNode);
      } finally {
        this.active = undefined;
        // Never race cancellation against effect settlement.
        await handle.close();
      }
      return true;
    }
    const active = this.active;
    if (!active || active.moduleId !== moduleId)
      throw Error("BLK-RPA-SCOPE-001");
    const step = active.request.plan.steps.find(
      (step) => step.stepId === node.nodeId,
    );
    if (!step) throw Error("BLK-RPA-SCOPE-001");
    const detail: TraceDetails = {
      rpa: {
        targetKind: active.request.plan.target.kind,
        phase: "performing",
        action: step.action,
        locatorKind: step.locator.kind,
        checkpointId: active.handle.checkpointId,
      },
    };
    report(detail);
    let input: string | undefined;
    try {
      if (step.action === "fill") {
        const source = active.request.inputSources[step.stepId];
        if (source === "manual") {
          if (!this.ports.manualInput) throw Error("BLK-RPA-INPUT-002");
          input = await this.ports.manualInput(
            { moduleId, blockId: step.stepId },
            this.signal,
          );
        } else {
          const value = source === "input" ? state.question : state.value;
          input = typeof value === "string" ? value : JSON.stringify(value);
        }
        if (
          typeof input !== "string" ||
          new TextEncoder().encode(input).length > 16384 ||
          input.includes("\0")
        )
          throw Error("BLK-RPA-INPUT-001");
      }
      this.signal.throwIfAborted();
      const result = readRpaResult(
        await active.handle.perform(step, input, this.signal),
      );
      this.signal.throwIfAborted();
      if (step.action === "read") state.value = result.text ?? null;
      if (step.action === "screenshot") {
        if (!result.capture || result.capture.checkpointId !== active.handle.checkpointId || result.capture.stepId !== step.stepId) throw Error("BLK-RPA-CAPTURE-002");
        state.value = result.capture;
      }
      detail.rpa!.phase = "completed";
      report(detail);
      return true;
    } finally {
      input = undefined;
    }
  }
}
