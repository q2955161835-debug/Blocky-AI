import { expect, it } from "vitest";
import { createRequire } from "node:module";
import { builderOperationSchema } from "../../packages/builder-protocol/src/validate";
import { surfaceSpecSchema } from "../../packages/app-surface/src/generated";
import tools from "../../packages/builder-engine/src/tool-schemas.json";
const { z } = createRequire(
  new URL("../../packages/builder-protocol/package.json", import.meta.url),
)("zod");
it("published builder patch tool has the same exact operation contract as accepted semantic edits", () => {
  const expected = z.toJSONSchema(
    z
      .object({
        operations: z.array(builderOperationSchema).max(100),
        surface: surfaceSpecSchema.optional(),
      })
      .strict(),
  );
  expect(tools.find((t) => t.name === "patch")!.parameters).toEqual(expected);
  const update = (expected.properties.operations.items.oneOf as any[]).find(
    (s) => s.properties.op.const === "block.update",
  );
  expect(update.required).toEqual(
    expect.arrayContaining(["moduleId", "blockId", "payload"]),
  );
  expect(update.additionalProperties).toBe(false);
  expect(update.properties.payload.required).toContain("fields");
});
