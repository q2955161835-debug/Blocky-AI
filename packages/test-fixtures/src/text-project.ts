import type { Project, WorkspaceBlock } from "@blocky/language-schema";
export function createTextProject(value: unknown = "已有文本"): Project {
  const literal: WorkspaceBlock = {
    type: "core.data.literal",
    id: "literal-one",
    fields: { VALUE: value as never },
  };
  return {
    manifest: {
      schemaVersion: "blocky.project/v1",
      projectId: "text-project",
      displayName: "文本回复",
      modules: [
        {
          moduleId: "main",
          displayName: "主画布",
          purpose: "general",
          workspaceRef: "workspaces/main.workspace.json",
          exports: [],
        },
      ],
      resources: [],
      appSurfaces: [],
      format: {
        createdWith: "blocky-desktop/0.2.0",
        minimumReaderVersion: "0.2.0",
      },
    },
    workspaces: {
      main: {
        blocks: {
          languageVersion: 0,
          blocks: [
            {
              type: "core.agent.define",
              id: "agent-one",
              fields: { NAME: "原有智能体" },
              x: 40,
              y: 60,
              inputs: {
                MEMBERS: {
                  block: {
                    type: "core.interaction.chat_entry",
                    id: "entry-one",
                    fields: { NAME: "文本入口" },
                    inputs: {
                      CAPABILITIES: {
                        block: {
                          type: "core.interaction.accept_text",
                          id: "accept-text",
                        },
                      },
                      HANDLER: {
                        block: {
                          type: "core.message.reply",
                          id: "reply-one",
                          inputs: {
                            MESSAGE: {
                              block: {
                                type: "core.message.create",
                                id: "message-one",
                                inputs: { CONTENT: { block: literal } },
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          ],
        },
      },
    },
    resources: {},
    schemas: {},
    surfaces: {},
  };
}
