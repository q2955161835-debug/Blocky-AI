import { expect, it } from "vitest";
import { compileProject } from "@blocky/compiler";
import { Runtime } from "../src";
import type { Project } from "@blocky/language-schema";

it("runs an independent rule module entry without an Agent root", async () => {
  const project: Project = {
    manifest: {
      schemaVersion: "blocky.project/v1", projectId: "rule-project", displayName: "规则项目",
      modules: [{ moduleId: "rule-main", displayName: "规则画布", purpose: "rule", workspaceRef: "workspaces/rule-main.workspace.json", exports: [] }],
      resources: [], appSurfaces: [], format: { createdWith: "blocky-desktop/0.7.0", minimumReaderVersion: "0.5.0" },
    },
    workspaces: { "rule-main": { blocks: { languageVersion: 0, blocks: [{
      type: "core.interaction.chat_entry", id: "rule-entry", fields: { NAME: "规则入口" },
      inputs: {
        CAPABILITIES: { block: { type: "core.interaction.accept_text", id: "accept-text" } },
        HANDLER: { block: {
          type: "core.message.reply", id: "rule-reply", inputs: { MESSAGE: { block: {
            type: "core.message.create", id: "rule-message", inputs: { CONTENT: { block: {
              type: "core.data.literal", id: "rule-output", fields: { VALUE: "规则结果" },
            } } },
          } } },
        } },
      },
    }] } } },
    resources: {}, schemas: {}, surfaces: {},
  };
  const compiled = await compileProject(project);
  expect(compiled.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
  expect(compiled.interaction.entries[0].ownerAgentId).toBe("rule-entry");
  const result = await new Runtime().run(project, "rule-entry", "input");
  expect(result.status).toBe("completed");
  expect(result.answer).toBe("规则结果");
  expect(result.events.find((event) => event.type === "block.completed" && event.blockId === "rule-reply")?.data.elapsedMs).toBeTypeOf("number");
});
