import type { Project, WorkspaceBlock } from "@blocky/language-schema";
export function createStarter(): Project {
  const reply: WorkspaceBlock = {
    type: "core.output.answer",
    id: "reply-answer",
    fields: { STYLE: "条目" },
  };
  const compose: WorkspaceBlock = {
    type: "core.model.compose",
    id: "compose-answer",
    fields: { RESOURCE: "local-composer" },
    next: { block: reply },
  };
  const call: WorkspaceBlock = {
    type: "core.module.call",
    id: "call-citation",
    fields: {
      MODULE: "citation-service",
      EXPORT: "lookup-v1",
      INPUT: "schemas/query.json",
      OUTPUT: "schemas/citations.json",
    },
    next: { block: compose },
  };
  const chat: WorkspaceBlock = {
    type: "core.interaction.chat",
    id: "on-question",
    fields: { NAME: "资料问答" },
    next: { block: call },
  };
  const agent: WorkspaceBlock = {
    type: "core.agent",
    id: "research-root",
    x: 80,
    y: 70,
    fields: { ROLE: "用清晰可靠的中文回答，只引用资料中的事实" },
    inputs: { BODY: { block: chat } },
  };
  return {
    manifest: {
      schemaVersion: "blocky.project/v1",
      projectId: "research-workbench",
      displayName: "资料问答伙伴",
      modules: [
        {
          moduleId: "research-agent",
          displayName: "研究助手",
          purpose: "agent",
          workspaceRef: "workspaces/research-agent.workspace.json",
          exports: [
            {
              exportId: "answer-with-citations",
              displayName: "生成带引用回答",
              kind: "agent",
              inputSchemaRef: "schemas/question.json",
              outputSchemaRef: "schemas/answer.json",
            },
          ],
        },
        {
          moduleId: "citation-service",
          displayName: "引用服务",
          purpose: "service",
          workspaceRef: "workspaces/citation-service.workspace.json",
          exports: [
            {
              exportId: "lookup-v1",
              displayName: "检索引用",
              kind: "tool",
              inputSchemaRef: "schemas/query.json",
              outputSchemaRef: "schemas/citations.json",
            },
          ],
        },
      ],
      resources: [
        {
          resourceId: "product-handbook",
          kind: "knowledge",
          scope: "project",
          definitionRef: "resources/product-handbook.json",
          secretRefs: ["handbook-access"],
        },
        {
          resourceId: "local-composer",
          kind: "model",
          scope: "project",
          definitionRef: "resources/local-composer.json",
          secretRefs: [],
        },
      ],
      appSurfaces: [],
      format: {
        createdWith: "blocky-desktop/0.2.0",
        minimumReaderVersion: "0.2.0",
      },
    },
    workspaces: {
      "research-agent": { blocks: { languageVersion: 0, blocks: [agent] } },
      "citation-service": {
        blocks: {
          languageVersion: 0,
          blocks: [
            {
              type: "core.tool.entry",
              id: "lookup-entry",
              x: 80,
              y: 70,
              fields: { EXPORT: "lookup-v1" },
              inputs: {
                BODY: {
                  block: {
                    type: "core.knowledge.retrieve",
                    id: "lookup-documents",
                    fields: { RESOURCE: "product-handbook" },
                  },
                },
              },
            },
          ],
        },
      },
    },
    resources: {
      "product-handbook": {
        schemaVersion: "blocky.resource/v1alpha1",
        resourceId: "product-handbook",
        kind: "knowledge",
        scope: "project",
        displayName: "自然科学资料",
        definition: {
          collection: "science",
          implementationRef: "adapter://deterministic/knowledge-v1",
        },
        capabilityRequirements: ["knowledge.read"],
        secretBindings: [{ fieldId: "access", secretRef: "handbook-access" }],
      },
      "local-composer": {
        schemaVersion: "blocky.resource/v1alpha1",
        resourceId: "local-composer",
        kind: "model",
        scope: "project",
        displayName: "本地文本整理",
        definition: {
          implementationRef: "adapter://deterministic/composer-v1",
        },
        capabilityRequirements: [],
        secretBindings: [],
      },
    },
    schemas: {
      "schemas/question.json": { type: "string" },
      "schemas/query.json": { type: "string" },
      "schemas/answer.json": { type: "object" },
      "schemas/cited-answer.json": { type: "object" },
      "schemas/citations.json": { type: "array" },
    },
    surfaces: {},
  };
}
export { createParallelProject } from "./parallel-project";
