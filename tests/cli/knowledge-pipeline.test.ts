import { expect, it, vi } from "vitest";
vi.mock("../../tools/blocky-cli/src/native-store", () => ({
  readProject: async () => ({ manifest: { projectId: "cli-knowledge" } }),
  createProject: async () => {
    throw Error("must not modify project");
  },
  nativeUserOperation: async (operation: string) => {
    if (operation === "knowledge-sources")
      return {
        generation: 1,
        sources: [
          {
            sourceId: "s",
            kind: "file",
            title: "Public",
            revision: "v1",
            readable: true,
            allowedPrincipals: ["local-user"],
            metadata: {},
          },
        ],
      };
    if (operation === "knowledge-read-source")
      return {
        sourceId: "s",
        revision: "v1",
        generation: 1,
        nextCursor: null,
        excluded: [],
        documents: [
          {
            documentId: "d",
            title: "Plants",
            format: "text",
            text: "Plants need water.",
            revision: "v1",
            locator: { path: "plants.txt", lineStart: 1, lineEnd: 1 },
            metadata: {},
          },
        ],
      };
    throw Error(operation);
  },
}));
import { parse } from "../../tools/blocky-cli/src/arguments";
import {
  knowledgeCommand,
  knowledgeHelp,
} from "../../tools/blocky-cli/src/knowledge";
import { discoveryCommand } from "../../tools/blocky-cli/src/discovery";
it("discovers ingestion and judgment schemas and previews the same native document segments", async () => {
  expect(knowledgeHelp.some((line) => line.includes("pipeline"))).toBe(true);
  const schemas = discoveryCommand(parse(["schema", "list", "--json"]), [])!;
  expect(JSON.stringify(schemas)).toContain("blocky.knowledge-ingestion/v1");
  expect(JSON.stringify(schemas)).toContain("blocky.knowledge-judgment/v1");
  const result = await knowledgeCommand(
    parse([
      "knowledge",
      "pipeline",
      "public.blocky",
      "--collection",
      "c",
      "--stage",
      "parse",
      "--json",
    ]),
    new AbortController().signal,
  );
  expect(result?.code).toBe(0);
  expect(JSON.stringify(result)).toContain("Plants need water.");
});
it("rejects unknown stages and invalid ingestion budgets without changing the project", async () => {
  await expect(
    knowledgeCommand(
      parse([
        "knowledge",
        "pipeline",
        "public.blocky",
        "--collection",
        "c",
        "--stage",
        "shell",
        "--json",
      ]),
      new AbortController().signal,
    ),
  ).rejects.toMatchObject({ code: "BLK-CLI-002" });
  await expect(
    knowledgeCommand(
      parse([
        "knowledge",
        "pipeline",
        "public.blocky",
        "--collection",
        "c",
        "--stage",
        "chunk",
        "--options",
        '{"size":10,"overlap":10}',
        "--json",
      ]),
      new AbortController().signal,
    ),
  ).rejects.toMatchObject({ code: "BLK-KNOWLEDGE-BUDGET" });
});
