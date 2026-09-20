import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { builderOperationSchema } from "../packages/builder-protocol/src/validate";
import { surfaceSpecSchema } from "../packages/app-surface/src/generated";
const { z } = createRequire(
  new URL("../packages/builder-protocol/package.json", import.meta.url),
)("zod");
const path = "packages/builder-engine/src/tool-schemas.json";
const tools = JSON.parse(await readFile(path, "utf8"));
tools.find((tool: { name: string }) => tool.name === "patch").parameters =
  z.toJSONSchema(
    z
      .object({
        operations: z.array(builderOperationSchema).max(100),
        surface: surfaceSpecSchema.optional(),
      })
      .strict(),
  );
await writeFile(path, JSON.stringify(tools, null, 2) + "\n");
