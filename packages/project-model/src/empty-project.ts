import type { Project } from "@blocky/language-schema";

/** A fresh editing document shared by desktop and CLI. */
export function createEmptyProject(displayName = "未命名项目"): Project {
  const name = displayName.trim();
  if (!name || name.length > 200) throw Error("BLK-PROJECT-NAME-001");
  return {
    manifest: {
      schemaVersion: "blocky.project/v1",
      projectId: `project-${crypto.randomUUID()}`,
      displayName: name,
      modules: [{
        moduleId: "main",
        displayName: "主画布",
        purpose: "general",
        workspaceRef: "workspaces/main.workspace.json",
        exports: [],
      }],
      resources: [],
      appSurfaces: [],
      format: { createdWith: "blocky-desktop/0.8.0", minimumReaderVersion: "0.2.0" },
    },
    workspaces: { main: { blocks: { languageVersion: 0, blocks: [] } } },
    resources: {},
    schemas: {},
    surfaces: {},
  };
}
