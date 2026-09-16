import { it, expect } from "vitest";
import { Runtime } from "../src";
import { createStarter } from "../../test-fixtures/src";
import { RedactedBus } from "../../observability/src";
it("pauses at a runtime boundary, resumes with events, and cancels while paused", async () => {
  for (const cancelled of [false, true]) {
    const runtime = new Runtime({ delayMs: 1 }),
      abort = new AbortController();
    let paused = false,
      sequence = 0;
    const result = await runtime.run(
      createStarter(),
      "on-question",
      "树叶为什么变黄",
      {
        signal: abort.signal,
        onEvent: (e) => {
          if (e.type === "run.started") runtime.pause();
          if (e.type === "run.paused") {
            paused = true;
            sequence = e.sequence;
            setTimeout(() => {
              if (cancelled) abort.abort();
              else runtime.resume();
            }, 30);
          } else if (paused) {
            expect(e.type).toBe(cancelled ? "run.cancelled" : "run.resumed");
            expect(e.sequence).toBeGreaterThan(sequence);
            paused = false;
          }
        },
      },
    );
    expect(result.status).toBe(cancelled ? "cancelled" : "completed");
  }
});
it("excludes arbitrary text and attributes from diagnostics while keeping the session view", () => {
  const bus = new RedactedBus();
  bus.write("runtime", "info", "PRIVATE_TEST_BODY", {
    question: "PRIVATE_TEST_QUESTION",
    custom: "PRIVATE_TEST_ATTRIBUTE",
  });
  expect(JSON.stringify(bus.export())).not.toContain("PRIVATE_TEST");
  expect(bus.records[0].message).toBe("PRIVATE_TEST_BODY");
  const record = bus.export().records[0];
  expect(Object.keys(record).sort()).toEqual([
    "channel",
    "level",
    "sequence",
    "timestamp",
  ]);
});
