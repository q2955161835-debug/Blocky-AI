import { it, expect } from "vitest";
import { Runtime, localAdapters } from "../../runtime-core/src/index";
import { createStarter } from "../../test-fixtures/src/index";
import { resolveResource } from "../../resource-registry/src/index";
import {
  EventFactory,
  RedactedBus,
  redact,
} from "../../observability/src/index";

it("edited role and style reach execution; ungrounded model citation rejected", async () => {
  const p = createStarter();
  const agent = p.workspaces["research-agent"].blocks.blocks[0];
  agent.fields!.ROLE = "教师";
  const adapters = localAdapters();
  let observed = "";
  adapters.model.set("adapter://deterministic/composer-v1", async (input) => {
    observed = input.role;
    return [
      ...input.citations,
      { id: "invented", title: "fake", text: "ungrounded" },
    ];
  });
  const r = await new Runtime({ adapters }).run(p, "on-question", "水循环");
  expect(observed).toBe("教师");
  expect(r.answer).toContain("学习要点");
  expect(r.answer).not.toContain("ungrounded");
  expect(r.status).toBe("completed");
});
it("wrong scope and unlisted secret reference fail closed", () => {
  const p = createStarter();
  p.resources["product-handbook"].scope = "user";
  expect(() => resolveResource(p, "product-handbook", "knowledge")).toThrow(
    "BLK-RESOURCE-001",
  );
  p.resources["product-handbook"].scope = "project";
  p.resources["product-handbook"].secretBindings[0].secretRef = "other-secret";
  expect(() => resolveResource(p, "product-handbook", "knowledge")).toThrow(
    "BLK-RESOURCE-002",
  );
});
it("adapter cancellation reaches signal and has one terminal event", async () => {
  const a = localAdapters(),
    c = new AbortController();
  let observed = false;
  a.knowledge.set(
    "adapter://deterministic/knowledge-v1",
    async (_, __, signal) =>
      new Promise<never>((resolve, reject) => {
        signal.addEventListener(
          "abort",
          () => {
            observed = true;
            reject(signal.reason);
          },
          { once: true },
        );
        queueMicrotask(() => c.abort());
      }),
  );
  const r = await new Runtime({ adapters: a }).run(
    createStarter(),
    "on-question",
    "水循环",
    { signal: c.signal },
  );
  expect(observed).toBe(true);
  expect(r.status).toBe("cancelled");
  expect(r.events.at(-1)?.type).toBe("run.cancelled");
  expect(
    r.events.filter((e) => /^run\.(completed|failed|cancelled)$/.test(e.type)),
  ).toHaveLength(1);
});
it("project cannot erase knowledge adapter capability requirement", async () => {
  const p = createStarter();
  p.resources["product-handbook"].capabilityRequirements = [];
  const a = localAdapters();
  let called = false;
  a.knowledge.set("adapter://deterministic/knowledge-v1", async () => {
    called = true;
    return [];
  });
  const r = await new Runtime({ adapters: a, capabilities: [] }).run(
    p,
    "on-question",
    "水循环",
  );
  expect(called).toBe(false);
  expect(r.status).toBe("failed");
});
it.each(["knowledge", "model"] as const)(
  "%s adapter failure closes correlated invocation",
  async (kind) => {
    const a = localAdapters();
    a[kind].set(
      kind === "knowledge"
        ? "adapter://deterministic/knowledge-v1"
        : "adapter://deterministic/composer-v1",
      async () => {
        throw Error("fictional failure");
      },
    );
    const r = await new Runtime({ adapters: a }).run(
      createStarter(),
      "on-question",
      "水循环",
    );
    const prefix = kind === "knowledge" ? "tool" : "model";
    const start = r.events.find((e) => e.type === `${prefix}.started`)!;
    expect(r.status).toBe("failed");
    expect(
      r.events.some(
        (e) =>
          e.type === `${prefix}.failed` &&
          e.correlationId === start.correlationId,
      ),
    ).toBe(true);
  },
);
it("separate runtime objects preserve process unique event sequences", async () => {
  const a = await new Runtime().run(createStarter(), "on-question", "水循环");
  const b = await new Runtime().run(createStarter(), "on-question", "水循环");
  const s = [...a.events, ...b.events].map((e) => e.sequence);
  expect(new Set(s).size).toBe(s.length);
});
it("sensitive structured credential keys cannot reach bus or export", () => {
  const bus = new RedactedBus();
  bus.write("host", "info", "safe", {
    refresh_token: "FICTIONAL_REFRESH",
    client_secret: "FICTIONAL_CLIENT",
    headers: { Cookie: "FICTIONAL_COOKIE" },
  });
  const output = JSON.stringify({ live: bus.records, exported: bus.export() });
  expect(output).not.toContain("FICTIONAL_REFRESH");
  expect(output).not.toContain("FICTIONAL_CLIENT");
  expect(output).not.toContain("FICTIONAL_COOKIE");
});
it("truncation produces an explicit structured signal", () => {
  const r = redact({ message: "中".repeat(17000) });
  expect(r.redaction.categories).toContain("oversize");
});
it("bus bounds encoded bytes and reports high-level drops", () => {
  const b = new RedactedBus(2, 1000);
  for (let i = 0; i < 20; i++) b.write("host", "error", "中".repeat(20));
  expect(
    new TextEncoder().encode(JSON.stringify(b.records)).length,
  ).toBeLessThanOrEqual(1000);
  expect(b.droppedImportant).toBeGreaterThan(0);
});
