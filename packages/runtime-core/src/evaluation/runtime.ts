import { stableId, type Project, type Resource } from "@blocky/language-schema";
import type { Runtime, RunResult } from "../runtime";
import {
  EvaluationRunnerError,
  type EvaluationExecutionContext,
  type EvaluationRunResult,
} from "./evaluation";
import type { EvaluationCase } from "./schema";

export type RuntimeEvaluationExecutorOptions = {
  project: Project;
  createRuntime: (context: EvaluationExecutionContext) => EvaluationRuntime;
  interactionId: string;
  moduleId?: string;
  userRegistry?: Map<string, Resource>;
};

export type EvaluationRuntime = {
  run: Runtime["run"];
  dispose?: () => Promise<void> | void;
};

const evaluationRuntimes = new WeakSet<object>();
const errorCodePattern = /^BLK-[A-Z0-9-]{3,64}$/;

function questionFor(testCase: EvaluationCase): string {
  const input = testCase.input as unknown;
  if (typeof input === "string") return input;
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).length !== 1 ||
    !Object.hasOwn(input, "question") ||
    typeof (input as { question?: unknown }).question !== "string"
  )
    throw new EvaluationRunnerError("BLK-EVAL-INPUT", "none");
  return (input as { question: string }).question;
}

function runErrorCode(result: RunResult): string | undefined {
  const terminal = [...result.events]
    .reverse()
    .find((event) => ["run.failed", "run.cancelled"].includes(event.type));
  const candidate = terminal?.data.code;
  if (typeof candidate === "string" && errorCodePattern.test(candidate))
    return candidate;
  if (result.status === "failed") return "BLK-EVAL-RUN-FAILED";
  if (result.status === "cancelled") return "BLK-RUN-005";
  if (result.status === "waiting") return "BLK-EVAL-RUN-WAITING";
  return undefined;
}

function mapRunResult(result: RunResult): EvaluationRunResult {
  return {
    status: result.status,
    answer: result.answer,
    citations: result.citations,
    ...(result.structured !== undefined
      ? { structured: result.structured }
      : {}),
    ...(result.generations !== undefined
      ? { generations: result.generations }
      : {}),
    ...(runErrorCode(result) ? { errorCode: runErrorCode(result) } : {}),
  };
}

/** Executes evaluation cases through the normal Runtime.run path, with one fresh session per case. */
export function createRuntimeEvaluationExecutor(
  options: RuntimeEvaluationExecutorOptions,
): (
  testCase: EvaluationCase,
  context: EvaluationExecutionContext,
) => Promise<EvaluationRunResult> {
  if (
    !stableId.test(options.interactionId) ||
    (options.moduleId !== undefined && !stableId.test(options.moduleId))
  )
    throw new EvaluationRunnerError("BLK-EVAL-RUN-ENTRY", "none");

  return async (testCase, context) => {
    context.signal.throwIfAborted();
    const question = questionFor(testCase);
    const runtime = options.createRuntime(context);
    if (
      !runtime ||
      typeof runtime !== "object" ||
      typeof runtime.run !== "function" ||
      (runtime.dispose !== undefined &&
        typeof runtime.dispose !== "function") ||
      evaluationRuntimes.has(runtime)
    )
      throw new EvaluationRunnerError("BLK-EVAL-RUN-SESSION", "none");
    evaluationRuntimes.add(runtime);

    try {
      context.signal.throwIfAborted();
      const result: RunResult = await runtime.run(
        options.project,
        options.interactionId,
        question,
        {
          ...(options.moduleId ? { moduleId: options.moduleId } : {}),
          signal: context.signal,
          ...(options.userRegistry
            ? { userRegistry: options.userRegistry }
            : {}),
        },
      );
      context.signal.throwIfAborted();
      return mapRunResult(result);
    } catch (error) {
      if (context.signal.aborted || error instanceof EvaluationRunnerError)
        throw error;
      const code =
        error instanceof Error && errorCodePattern.test(error.message)
          ? error.message
          : "BLK-EVAL-RUN-FAILED";
      throw new EvaluationRunnerError(code, "unknown");
    } finally {
      try {
        await runtime.dispose?.();
      } catch {
        throw new EvaluationRunnerError("BLK-EVAL-RUN-SETTLEMENT", "unknown");
      }
    }
  };
}
