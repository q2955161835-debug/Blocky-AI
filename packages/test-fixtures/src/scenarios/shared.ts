import type {
  ModuleDescriptor,
  Project,
  WorkspaceBlock,
} from "@blocky/language-schema";
export function projectShell(projectId: string, displayName: string): Project {
  return {
    manifest: {
      schemaVersion: "blocky.project/v1",
      projectId,
      displayName,
      modules: [],
      resources: [],
      appSurfaces: [],
      format: {
        createdWith: "blocky-desktop/0.8.0",
        minimumReaderVersion: "0.3.0",
      },
    },
    workspaces: {},
    resources: {},
    schemas: {},
    surfaces: {},
  };
}
export function moduleDescriptor(
  moduleId: string,
  displayName: string,
  purpose: ModuleDescriptor["purpose"],
  exportId: string,
  kind: "agent" | "tool",
  input: string,
  output: string,
): ModuleDescriptor {
  return {
    moduleId,
    displayName,
    purpose,
    workspaceRef: `workspaces/${moduleId}.workspace.json`,
    exports: [
      {
        exportId,
        displayName,
        kind,
        inputSchemaRef: input,
        outputSchemaRef: output,
      },
    ],
  };
}
export function mainRoot(
  role: string,
  name: string,
  call: WorkspaceBlock,
): WorkspaceBlock {
  return {
    type: "core.agent",
    id: "research-root",
    x: 80,
    y: 70,
    fields: { ROLE: role },
    inputs: {
      BODY: {
        block: {
          type: "core.interaction.chat",
          id: "on-question",
          fields: { NAME: name },
          next: { block: call },
        },
      },
    },
  };
}
