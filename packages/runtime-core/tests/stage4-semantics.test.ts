import { expect, it } from "vitest";
import { createStarter } from "../../test-fixtures/src/index";
import { Runtime, localAdapters } from "../src/index";
import type { WorkspaceBlock } from "@blocky/language-schema";

function project(...blocks: WorkspaceBlock[]) {
  const p = createStarter();
  for (let i = 0; i < blocks.length - 1; i++)
    blocks[i].next = { block: blocks[i + 1] };
  p.workspaces["research-agent"].blocks.blocks[0].inputs!.BODY.block!.next = {
    block: blocks[0],
  };
  return p;
}
const output = (): WorkspaceBlock => ({
  type: "core.output.structured",
  id: "json-out",
  fields: { SCHEMA: "schemas/value.json" },
});
it("executes only the selected condition branch and returns validated structured data", async () => {
  const p = project(
    {
      type: "core.logic.condition",
      id: "choose",
      fields: { SOURCE: "input", OP: "equals", VALUE: "yes" },
      inputs: {
        THEN: {
          block: {
            type: "core.data.set",
            id: "set-ok",
            fields: { VALUE: '{"ok":true}' },
          },
        },
        ELSE: {
          block: {
            type: "core.data.set",
            id: "set-no",
            fields: { VALUE: '{"ok":false}' },
          },
        },
      },
    },
    output(),
  );
  p.schemas["schemas/value.json"] = {
    type: "object",
    properties: { ok: { type: "boolean" } },
    required: ["ok"],
    additionalProperties: false,
  };
  const result = await new Runtime().run(p, "on-question", "yes");
  expect(result.status).toBe("completed");
  expect(result.structured).toEqual({ ok: true });
  expect(result.events.some((e) => e.blockId === "set-no")).toBe(false);
});
it("rejects unsupported JSON Schema instead of accepting it silently", async () => {
  const p = project(
    { type: "core.data.set", id: "set-ok", fields: { VALUE: "3" } },
    output(),
  );
  p.schemas["schemas/value.json"] = { type: "number", multipleOf: 2 };
  const result = await new Runtime().run(p, "on-question", "test");
  expect(result.status).toBe("failed");
  expect(result.structured).toBeUndefined();
});
it("enforces run step limits and produces one terminal event", async () => {
  const p = project(
    {
      type: "core.run.budget",
      id: "limits",
      fields: {
        STEPS: "2",
        CALLS: "1",
        OUTPUT_TOKENS: "32",
        TIMEOUT_MS: "1000",
      },
    },
    { type: "core.data.set", id: "set-ok", fields: { VALUE: "true" } },
  );
  const r = await new Runtime().run(p, "on-question", "test");
  expect(r.status).toBe("failed");
  expect(r.events.at(-1)?.data.code).toBe("BLK-RUN-004");
});
it("ignores a non-cooperative adapter after cancellation and returns promptly", async () => {
  const adapters = localAdapters();
  adapters.model.set(
    "adapter://deterministic/composer-v1",
    () => new Promise(() => {}),
  );
  const abort = new AbortController();
  const result = new Runtime({ adapters }).run(
    createStarter(),
    "on-question",
    "水循环",
    { signal: abort.signal },
  );
  setTimeout(() => abort.abort(), 20);
  expect((await result).status).toBe("cancelled");
}, 1000);
