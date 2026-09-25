import { expect, it } from "vitest";
import { Runtime } from "../src";
import { createStarter } from "../../test-fixtures/src";

it("stops on a source breakpoint and advances exactly one block before the next pause", async () => {
  const runtime = new Runtime({ delayMs: 1 });
  const pausedAt: string[] = [];
  let releases = 0;
  const result = await runtime.run(createStarter(), "on-question", "水循环", {
    debug: { breakpoints: [{ moduleId: "research-agent", blockId: "on-question" }] },
    onEvent(event) {
      if (event.type !== "run.paused") return;
      pausedAt.push(String(event.data.blockId));
      if (releases++ === 0) runtime.step();
      else runtime.resume();
    },
  });
  expect(result.status).toBe("completed");
  expect(pausedAt[0]).toBe("on-question");
  expect(pausedAt).toHaveLength(2);
  const first = result.events.findIndex((event) => event.type === "run.paused");
  const second = result.events.findIndex((event, index) => index > first && event.type === "run.paused");
  expect(result.events.slice(first + 1, second).filter((event) => event.type === "block.started")).toHaveLength(1);
});

it("cancels while stopped at a breakpoint without running the block", async () => {
  const runtime = new Runtime();
  const abort = new AbortController();
  const result = await runtime.run(createStarter(), "on-question", "水循环", {
    signal: abort.signal,
    debug: { breakpoints: [{ moduleId: "research-agent", blockId: "on-question" }] },
    onEvent(event) {
      if (event.type === "run.paused") abort.abort();
    },
  });
  expect(result.status).toBe("cancelled");
  expect(result.events.some((event) => event.type === "block.started" && event.blockId === "on-question")).toBe(false);
});

it("starts from a selected block in the chosen entry and rejects unrelated blocks", async () => {
  const runtime = new Runtime();
  const full = await runtime.run(createStarter(), "on-question", "水循环");
  const selected = full.events.find((event) => event.type === "block.started" && event.blockId === "on-question");
  expect(selected).toBeDefined();
  const from = await runtime.run(createStarter(), "on-question", "水循环", {
    debug: { startBlockId: "on-question" },
  });
  expect(from.status).toBe("completed");
  const unrelated = await runtime.run(createStarter(), "on-question", "水循环", {
    debug: { startBlockId: "lookup-documents" },
  });
  expect(unrelated.status).toBe("failed");
  expect(unrelated.events.at(-1)?.data.code).toBe("BLK-RUN-009");
  const withoutPrerequisite = await runtime.run(createStarter(), "on-question", "水循环", {
    debug: { startBlockId: "compose-answer" },
  });
  expect(withoutPrerequisite.status).toBe("failed");
  expect(withoutPrerequisite.events.at(-1)?.data.code).toBe("BLK-RUN-010");
});
