import { describe, expect, it } from "vitest";
import { createStarter } from "../../test-fixtures/src/index";
import { Runtime, localAdapters, type Generation } from "../src/index";
import { createRuntimeEvaluationExecutor } from "../src/evaluation";
import type {
  EvaluationBinding,
  EvaluationCandidate,
  EvaluationCase,
  EvaluationExecutionContext,
  EvaluationRuntime,
} from "../src/evaluation";

const candidate: EvaluationCandidate = {
  id: "assistant",
  version: "1.0",
  contentHash: "a".repeat(64),
};
const binding: EvaluationBinding = {
  configurationHash: "b".repeat(64),
  model: {
    resourceId: "local-composer",
    provider: "deepseek",
    modelId: "configured-model",
    version: "1",
  },
};
function context(
  signal = new AbortController().signal,
): EvaluationExecutionContext {
  return { signal, candidate, binding };
}
function testCase(input: unknown): EvaluationCase {
  return { caseId: "case-one", input: input as EvaluationCase["input"] };
}
function deterministicRuntime() {
  const project = createStarter();
  project.resources["local-composer"].definition = {
    provider: "deepseek",
    protocol: "openai-chat",
    modelId: "configured-model",
    timeoutMs: 1000,
    capabilities: ["text"],
    implementationRef: { kind: "adapter", id: "deepseek-v1" },
  };
  const adapters = localAdapters();
  let generated = 0;
  adapters.agent = {
    generate: async (request, signal) => {
      signal.throwIfAborted();
      generated++;
      return {
        text: "水循环资料答复 [source:water-cycle]",
        provider: "deepseek",
        transport: "local",
        model: "configured-model",
        requestId: request.requestId,
        usage: null,
      } satisfies Generation;
    },
  };
  return {
    project,
    runtime: new Runtime({ adapters }),
    generated: () => generated,
  };
}
function runtimeFacade(
  runtime: Runtime,
  dispose: () => Promise<void> | void = () => {},
): EvaluationRuntime {
  return { run: runtime.run.bind(runtime), dispose };
}

describe("Runtime evaluation adapter", () => {
  it("runs valid question input through Runtime and maps its actual result", async () => {
    const fixture = deterministicRuntime();
    const execute = createRuntimeEvaluationExecutor({
      project: fixture.project,
      createRuntime: () => runtimeFacade(fixture.runtime),
      interactionId: "on-question",
    });

    const result = await execute(testCase({ question: "水循环" }), context());

    expect(result.status).toBe("completed");
    expect(result.answer).toContain("水循环资料答复");
    expect(result.citations?.map(({ id }) => id)).toContain("water-cycle");
    expect(result.generations).toMatchObject([
      {
        provider: "deepseek",
        model: "configured-model",
        transport: "local",
        usage: null,
      },
    ]);
    expect(result).not.toHaveProperty("retrievalHitIds");
    expect(fixture.generated()).toBe(1);
  });

  it("rejects variables and extra fields with a stable error before creating Runtime", async () => {
    let created = 0;
    const fixture = deterministicRuntime();
    const execute = createRuntimeEvaluationExecutor({
      project: fixture.project,
      createRuntime: () => {
        created++;
        return runtimeFacade(fixture.runtime);
      },
      interactionId: "on-question",
    });

    await expect(
      execute(testCase({ question: "水循环", variables: {} }), context()),
    ).rejects.toThrow("BLK-EVAL-INPUT");
    await expect(
      execute(testCase({ question: "水循环", extra: true }), context()),
    ).rejects.toThrow("BLK-EVAL-INPUT");
    expect(created).toBe(0);
  });

  it("creates a fresh Runtime for every case and rejects reused sessions", async () => {
    const project = createStarter();
    const runtimes: EvaluationRuntime[] = [];
    const execute = createRuntimeEvaluationExecutor({
      project,
      createRuntime: () => {
        const runtime = runtimeFacade(new Runtime());
        runtimes.push(runtime);
        return runtime;
      },
      interactionId: "on-question",
    });

    await execute(testCase("水循环"), context());
    await execute(testCase("秋天的叶子"), context());
    expect(runtimes).toHaveLength(2);
    expect(runtimes[0]).not.toBe(runtimes[1]);

    const shared = runtimeFacade(new Runtime());
    const invalidFactory = createRuntimeEvaluationExecutor({
      project,
      createRuntime: () => shared,
      interactionId: "on-question",
    });
    await invalidFactory(testCase("水循环"), context());
    await expect(invalidFactory(testCase("水循环"), context())).rejects.toThrow(
      "BLK-EVAL-RUN-SESSION",
    );
  });

  it("passes cancellation through to Runtime and waits for its model work to stop", async () => {
    const project = createStarter();
    project.resources["local-composer"].definition = {
      provider: "deepseek",
      protocol: "openai-chat",
      modelId: "configured-model",
      timeoutMs: 1000,
      capabilities: ["text"],
      implementationRef: { kind: "adapter", id: "deepseek-v1" },
    };
    const adapters = localAdapters();
    let started!: () => void;
    const didStart = new Promise<void>((resolve) => (started = resolve));
    let aborted = false;
    adapters.agent = {
      generate: async (request, signal) => {
        started();
        await new Promise<void>((resolve) => {
          if (signal.aborted) {
            aborted = true;
            resolve();
            return;
          }
          signal.addEventListener(
            "abort",
            () => {
              aborted = true;
              resolve();
            },
            { once: true },
          );
        });
        signal.throwIfAborted();
        return {
          text: "unused",
          provider: "deepseek",
          transport: "local",
          model: "configured-model",
          requestId: request.requestId,
          usage: null,
        } satisfies Generation;
      },
    };
    const controller = new AbortController();
    let disposed = false;
    const execute = createRuntimeEvaluationExecutor({
      project,
      createRuntime: () =>
        runtimeFacade(new Runtime({ adapters }), () => {
          disposed = true;
        }),
      interactionId: "on-question",
    });
    const pending = execute(testCase("水循环"), context(controller.signal));
    await didStart;
    controller.abort();
    await expect(pending).rejects.toThrow();
    expect(aborted).toBe(true);
    expect(disposed).toBe(true);
  });
});
