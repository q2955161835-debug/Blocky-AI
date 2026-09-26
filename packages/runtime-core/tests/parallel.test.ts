import { expect, it } from "vitest";
import { compileProject } from "@blocky/compiler";
import type { WorkspaceBlock as Block } from "@blocky/language-schema";
import { createArchitectureStarter } from "../../block-catalog/src";
import { Runtime } from "../src";

const result = (id: string, value: unknown): Block => ({ type: "core.data.set", id, fields: { VALUE: JSON.stringify(value) } });
const delayed = (id: string, ms: number, next: Block): Block => ({ type: "core.flow.delay", id, fields: { MILLISECONDS: String(ms) }, next: { block: next } });
function parallel(left: Block, right: Block, id = "parallel"): Block {
  return { type: "core.flow.parallel", id, inputs: { LEFT: { block: left }, RIGHT: { block: right } } };
}
function project(body: Block) {
  const p = createArchitectureStarter("rule-engine");
  p.schemas["schemas/result.json"] = { type: "array", items: { type: "string" }, maxItems: 2 };
  p.workspaces.main.blocks.blocks[0].inputs!.HANDLER = { block: body };
  body.next = { block: { type: "core.output.structured", id: "output", fields: { SCHEMA: "schemas/result.json" } } };
  return p;
}

it("starts both branches before either delay ends and joins isolated values in port order", async () => {
  const p = project(parallel(delayed("left-wait", 80, result("left", "private-left")), delayed("right-wait", 10, result("right", "private-right"))));
  expect((await compileProject(p)).diagnostics).toEqual([]);
  const run = await new Runtime().run(p, "on-event", "");
  expect(run.status, JSON.stringify(run.events.at(-1))).toBe("completed");
  expect(run.structured).toEqual(["private-left", "private-right"]);
  const order = run.events.map(e => `${e.type}:${e.blockId}`);
  expect(order.indexOf("block.started:right-wait")).toBeLessThan(order.indexOf("block.completed:left-wait"));
  expect(order.indexOf("block.completed:right")).toBeLessThan(order.indexOf("block.completed:left"));
  expect(JSON.stringify(run.events)).not.toContain("private-");
});

it("settles every branch before reporting failure and never emits late events after cancellation", async () => {
  const p = project(parallel({ type: "core.flow.fail", id: "rejected" }, delayed("other-wait", 30, result("other", 2))));
  const failed = await new Runtime().run(p, "on-event", "");
  expect(failed.status).toBe("failed");
  expect(failed.events.some(e => e.type === "block.completed" && e.blockId === "other")).toBe(true);
  expect(failed.events.at(-1)?.type).toBe("run.failed");
  expect(failed.events.at(-1)?.data.code).toBe("BLK-FLOW-003");
  const controller = new AbortController();
  const events: unknown[] = [];
  const cancelled = await new Runtime().run(project(parallel(delayed("one", 1000, result("a", 1)), delayed("two", 1000, result("b", 2)))), "on-event", "", {
    signal: controller.signal,
    onEvent(event) { events.push(event); if (event.blockId === "two" && event.type === "block.started") controller.abort(); },
  });
  expect(cancelled.status).toBe("cancelled");
  const count = events.length;
  await new Promise(resolve => setTimeout(resolve, 40));
  expect(events).toHaveLength(count);
  expect(cancelled.events.some(e => e.blockId === "a" || e.blockId === "b")).toBe(false);
});

it("rejects side effects and excessive nesting before starting any branch", async () => {
  const unsafe = project(parallel({ type: "core.memory.write", id: "write", fields: { SCOPE: "session", KEY: "key", SOURCE: "input" } }, result("safe", 1)));
  expect((await compileProject(unsafe)).diagnostics.some(d => d.code === "BLK-FLOW-001" && d.source?.blockId === "parallel")).toBe(true);
  expect((await new Runtime().run(unsafe, "on-event", "")).events.some(e => e.type === "block.started")).toBe(false);
  let branch = result("end", 0);
  for (let i = 0; i < 5; i++) branch = parallel(branch, result(`right-${i}`, i), `nested-${i}`);
  expect((await compileProject(project(branch))).diagnostics.some(d => d.code === "BLK-FLOW-002")).toBe(true);
});

it("releases only one waiting parallel block for a single debugger step", async () => {
  const p = project(parallel({ type: "core.flow.delay", id: "left-pause", fields: { MILLISECONDS: "100" } }, { type: "core.flow.delay", id: "right-pause", fields: { MILLISECONDS: "100" } }));
  p.schemas["schemas/result.json"] = { type: "array", items: { type: "null" }, maxItems: 2 };
  const runtime = new Runtime(), cancel = new AbortController();
  const started: string[] = [];
  let paused = 0, release!: () => void;
  const ready = new Promise<void>(resolve => { release = resolve; });
  const work = runtime.run(p, "on-event", "", {
    signal: cancel.signal,
    debug: { breakpoints: ["left-pause", "right-pause"].map(blockId => ({ moduleId: "main", blockId })) },
    onEvent(event) {
      if (event.type === "run.paused" && ++paused === 2) release();
      if (event.type === "block.started" && event.blockId?.endsWith("-pause")) started.push(event.blockId);
    },
  });
  try {
    await ready;
    runtime.step();
    await new Promise(resolve => setTimeout(resolve, 150));
    expect(started).toHaveLength(1);
    runtime.resume();
    expect((await work).status).toBe("completed");
  } finally { cancel.abort(); await work; }
});
