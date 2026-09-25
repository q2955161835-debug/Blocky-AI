import { expect, it } from "vitest";
import { Runtime } from "../src";
import { TraceSession } from "../../observability/src";
import { createStarter } from "../../test-fixtures/src";

it("replays a bounded trace without re-running tools and without answer bodies", async () => {
  const result = await new Runtime().run(createStarter(), "on-question", "水循环");
  const trace = new TraceSession(4);
  for (const event of result.events) trace.add(event);
  const replayed: string[] = [];
  trace.replay((frame) => replayed.push(frame.type));
  expect(replayed).toEqual(trace.list().map((frame) => frame.type));
  expect(trace.dropped).toBe(result.events.length - 4);
  expect(JSON.stringify(trace.export())).not.toContain(result.answer);
  expect(trace.at(result.events.at(-1)!.sequence)?.type).toBe("run.completed");
});
