import { expect, it } from "vitest";
import { Runtime } from "../../runtime-core/src";
import { createStarter } from "../../test-fixtures/src";
import { canvasVisuals } from "../src/canvas/runtime-visuals";
it("keeps the warning source after completion and resets it on the next run", async () => {
  const runtime = new Runtime();
  const warning = await runtime.run(
    createStarter(),
    "on-question",
    "没有资料的问题",
  );
  const states = canvasVisuals(warning.events, "citation-service");
  expect(states.get("lookup-documents")?.state).toBe("warning");
  expect(states.get("lookup-documents")?.sequence).toBe(
    warning.events.find((e) => e.type === "block.warning")?.sequence,
  );
  expect([...states.values()].some((s) => s.state === "active")).toBe(false);
  const success = await runtime.run(createStarter(), "on-question", "水循环");
  expect(
    canvasVisuals([...warning.events, ...success.events], "citation-service")
      .size,
  ).toBe(0);
});
it("retains failed blocks after the terminal run event and links the same source sequence", async () => {
  const result = await new Runtime({ capabilities: [] }).run(
    createStarter(),
    "on-question",
    "水循环",
  );
  expect(result.status).toBe("failed");
  const failed = result.events.find(
    (e) => e.type === "block.failed" && e.blockId === "lookup-documents",
  )!;
  expect(
    canvasVisuals(result.events, "citation-service").get("lookup-documents"),
  ).toMatchObject({ state: "error", sequence: failed.sequence });
});
