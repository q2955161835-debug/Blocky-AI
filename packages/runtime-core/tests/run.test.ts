import { describe, expect, it } from "vitest";
import { createStarter } from "../../test-fixtures/src/index";
import { Runtime, localAdapters } from "../src/index";
import {
  projectVisual,
  projectLog,
  EventFactory,
  RedactedBus,
} from "../../observability/src/index";
import { readFileSync } from "node:fs";

describe("runtime executes edited project through injected adapters", () => {
  it("retrieves evidence and runs the referenced module before composing the answer", async () => {
    const result = await new Runtime().run(
      createStarter(),
      "on-question",
      "水循环是怎样形成的？",
    );
    expect(result.status).toBe("completed");
    expect(result.answer).toContain("蒸发");
    expect(result.answer).toContain("《水循环》");
    expect(
      result.events.some(
        (e) =>
          e.moduleId === "citation-service" &&
          e.blockId === "lookup-documents" &&
          e.type === "tool.completed",
      ),
    ).toBe(true);
    expect(
      result.events.filter((e) => e.type === "run.completed"),
    ).toHaveLength(1);
    expect(result.events.at(-1)?.type).toBe("run.completed");
  });
  it("does not turn unrelated or unsupported questions into a claimed answer", async () => {
    const result = await new Runtime().run(
      createStarter(),
      "on-question",
      "月球到这里精确距离是多少？",
    );
    expect(result.answer).toContain("待核实");
    expect(result.citations).toEqual([]);
    expect(result.events.some((e) => e.type === "block.warning")).toBe(true);
  });
  it("uses resource selection and rejects denied capabilities before calling the adapter", async () => {
    const p = createStarter();
    p.resources["product-handbook"].definition.collection = "blocky";
    const result = await new Runtime().run(p, "on-question", "水循环");
    expect(result.citations).toEqual([]);
    const denied = await new Runtime({ capabilities: [] }).run(
      createStarter(),
      "on-question",
      "水循环",
    );
    expect(denied.status).toBe("failed");
    expect(denied.events.some((e) => e.type === "tool.started")).toBe(false);
    expect(denied.events.at(-1)?.data.code).toBe("BLK-TOOL-001");
  });
  it("propagates cancellation and never publishes completion after terminal cancellation", async () => {
    const controller = new AbortController();
    const runtime = new Runtime({ delayMs: 100 });
    const promise = runtime.run(createStarter(), "on-question", "水循环", {
      signal: controller.signal,
    });
    controller.abort();
    const result = await promise;
    expect(result.status).toBe("cancelled");
    expect(result.events.at(-1)?.type).toBe("run.cancelled");
    expect(result.events.some((e) => e.type === "run.completed")).toBe(false);
  });
  it("reports adapter failure without leaking raw exception messages", async () => {
    const adapters = localAdapters();
    adapters.knowledge.set("adapter://deterministic/knowledge-v1", async () => {
      throw Error("password=FICTIONAL_PRIVATE_VALUE");
    });
    const result = await new Runtime({ adapters }).run(
      createStarter(),
      "on-question",
      "水循环",
    );
    expect(result.status).toBe("failed");
    expect(JSON.stringify(result.events)).not.toContain(
      "FICTIONAL_PRIVATE_VALUE",
    );
    expect(result.events.some((e) => e.type === "block.failed")).toBe(true);
  });
  it("creates reproducible events from a fixed clock and identity source", async () => {
    const options = {
      now: () => "2026-09-16T00:00:00.000Z",
      newId: () => "run-fixed",
    };
    const a = await new Runtime(options).run(
      createStarter(),
      "on-question",
      "水循环",
    );
    const b = await new Runtime(options).run(
      createStarter(),
      "on-question",
      "水循环",
    );
    expect(a.events).toEqual(b.events);
  });
});

describe("observability consumes contracts, not display text", () => {
  it("projects the original frozen event fixture", () => {
    const f = JSON.parse(
      readFileSync(
        "doc/技术设计/正式契约/fixtures/valid/deterministic-runtime-observability.json",
        "utf8",
      ),
    );
    for (const expected of f.expect.visualStates) {
      const e = f.payload.events.find(
        (e: { sequence: number }) => e.sequence === expected.eventSequence,
      );
      const { eventSequence, ...state } = expected;
      expect(projectVisual(e)).toEqual(state);
      expect(projectLog(e).traceTarget).toEqual({
        runId: e.runId,
        sequence: e.sequence,
      });
    }
  });
  it("prevents events after a terminal state and keeps process event sequence monotonic", () => {
    const factory = new EventFactory(() => "2026-09-16T00:00:00.000Z");
    const base = { projectId: "project", runId: "run-one" };
    factory.create({ ...base, type: "run.started", data: {} });
    factory.create({ ...base, type: "run.completed", data: {} });
    expect(() =>
      factory.create({ ...base, type: "block.started", data: {} }),
    ).toThrow();
    expect(
      factory.create({
        ...base,
        runId: "run-two",
        type: "run.started",
        data: {},
      }).sequence,
    ).toBe(3);
  });
  it("rejects an unredacted third-party record and exports only bounded sanitized content", () => {
    const f = JSON.parse(
      readFileSync(
        "doc/技术设计/正式契约/fixtures/invalid/secret-in-log-envelope.json",
        "utf8",
      ),
    );
    const bus = new RedactedBus(3, 2000);
    expect(bus.ingest(f.payload.candidateLog)).toBe("BLK-LOG-004");
    expect(bus.records).toHaveLength(0);
    for (let i = 0; i < 12; i++) bus.write("runtime", "info", "条目", { i });
    bus.write("runtime", "error", "处理失败", {
      authorization: "FICTIONAL_VALUE",
    });
    expect(bus.records.length).toBeLessThanOrEqual(3);
    expect(bus.dropped).toBeGreaterThan(0);
    expect(JSON.stringify(bus.export())).not.toContain("FICTIONAL_VALUE");
    expect(bus.records.at(-1)?.level).toBe("error");
  });
});
