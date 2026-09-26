import type { WorkspaceBlock } from "@blocky/language-schema";
import { createTextProject } from "./text-project";

export function createParallelProject() {
  const project = createTextProject();
  project.manifest.projectId = "parallel-project";
  project.manifest.displayName = "并行分支";
  project.manifest.format.minimumReaderVersion = "0.5.0";
  project.schemas["schemas/result.json"] = { type: "array", items: { type: "string" }, maxItems: 2 };
  const branch = (name: string, ms: number): WorkspaceBlock => ({
    type: "core.flow.delay", id: `${name}-wait`, fields: { MILLISECONDS: String(ms) },
    next: { block: { type: "core.data.set", id: `${name}-result`, fields: { VALUE: JSON.stringify(name) } } },
  });
  project.workspaces.main.blocks.blocks = [{
    type: "core.interaction.chat_entry", id: "on-parallel", x: 60, y: 40, fields: { NAME: "并行处理" },
    inputs: { HANDLER: { block: {
      type: "core.flow.parallel", id: "parallel", inputs: { LEFT: { block: branch("left", 80) }, RIGHT: { block: branch("right", 10) } },
      next: { block: { type: "core.output.structured", id: "output", fields: { SCHEMA: "schemas/result.json" } } },
    } } },
  }];
  return project;
}
