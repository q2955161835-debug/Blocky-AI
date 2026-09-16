import { expect, test } from "vitest";
import { createTextProject } from "../../test-fixtures/src/text-project";
import { compileProject } from "../../compiler/src/index";
import { Runtime } from "../src/runtime";
test("typed text atoms preserve source identities and literal JSON/message semantics", async () => {
  const p = createTextProject({ value: [1, "用户作品里的内容"] });
  const compiled = await compileProject(p);
  expect(compiled.diagnostics).toEqual([]);
  expect(compiled.interaction.entries[0]).toMatchObject({
    interactionId: "entry-one",
    ownerAgentId: "agent-one",
    acceptedParts: ["text"],
  });
  const result = await new Runtime().run(p, "entry-one", "无关输入", {
    moduleId: "main",
  });
  expect(result.status).toBe("completed");
  expect(result.answer).toBe('{"value":[1,"用户作品里的内容"]}');
  expect(
    result.events
      .filter((e) => e.type === "block.started")
      .map((e) => e.blockId),
  ).toEqual([
    "agent-one",
    "entry-one",
    "accept-text",
    "reply-one",
    "message-one",
    "literal-one",
  ]);
  expect(
    result.events.filter((e) => e.type === "model.chunk").map((e) => e.blockId),
  ).toEqual(["reply-one"]);
});
test("typed value connections and nonselected entry isolation are enforced", async () => {
  const p = createTextProject("first");
  const entry = p.workspaces.main.blocks.blocks[0].inputs!.MEMBERS.block!;
  const second = structuredClone(entry);
  const replaceIds = (b: typeof entry) => {
    b.id = `${b.id}-two`;
    Object.values(b.inputs ?? {}).forEach(
      (i) => i.block && replaceIds(i.block),
    );
  };
  replaceIds(second);
  entry.next = { block: second };
  const result = await new Runtime().run(p, "entry-one-two", "", {
    moduleId: "main",
  });
  expect(result.status).toBe("completed");
  expect(result.events.some((e) => e.blockId === "reply-one")).toBe(false);
  entry.inputs!.HANDLER.block!.inputs!.MESSAGE.block = {
    type: "core.data.literal",
    id: "wrong-value",
    fields: { VALUE: 42 },
  };
  const invalid = await compileProject(p);
  expect(
    invalid.diagnostics.some(
      (d) => d.code === "BLK-TYPE-009" && d.source?.blockId === "reply-one",
    ),
  ).toBe(true);
});
