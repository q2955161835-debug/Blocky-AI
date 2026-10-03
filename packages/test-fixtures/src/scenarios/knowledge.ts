import type { Project, WorkspaceBlock } from "@blocky/language-schema";
import { createAgentExample } from "./agent";
import { mainRoot, moduleDescriptor, projectShell } from "./shared";

function knowledgeProject(projectId: string): Project {
  const project = projectShell(projectId, "knowledge pipeline test scenario");
  const answer: WorkspaceBlock = {
    type: "core.output.answer",
    id: "reply-answer",
    fields: { STYLE: "条目" },
  };
  const compose: WorkspaceBlock = {
    type: "core.model.compose",
    id: "compose-answer",
    fields: { RESOURCE: "local-composer" },
    next: { block: answer },
  };
  const retrieve: WorkspaceBlock = {
    type: "core.knowledge.retrieve",
    id: "call-citation",
    fields: { RESOURCE: "product-handbook" },
    next: { block: compose },
  };
  project.manifest.modules = [
    moduleDescriptor(
      "research-agent",
      "Knowledge scenario",
      "agent",
      "answer-with-citations",
      "agent",
      "schemas/question.json",
      "schemas/answer.json",
    ),
    moduleDescriptor(
      "citation-service",
      "Knowledge lookup fixture",
      "service",
      "lookup-v1",
      "tool",
      "schemas/query.json",
      "schemas/citations.json",
    ),
  ];
  project.workspaces["research-agent"] = {
    blocks: {
      languageVersion: 0,
      blocks: [
        mainRoot(
          "Process a test knowledge request using declared resources.",
          "Knowledge test input",
          retrieve,
        ),
      ],
    },
  };
  project.workspaces["citation-service"] = {
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
  };
  project.resources["product-handbook"] = {
    schemaVersion: "blocky.resource/v1alpha1",
    resourceId: "product-handbook",
    kind: "knowledge",
    scope: "project",
    displayName: "Knowledge fixture",
    definition: {
      collection: "product-handbook",
      implementationRef: { kind: "adapter", id: "knowledge-local-v1" },
      sourceRef: { kind: "resource", id: "product-handbook" },
      chunking: { strategy: "paragraph", size: 768, overlap: 64 },
      index: { strategy: "keyword" },
      retrieval: { strategy: "keyword", topK: 5 },
    },
    capabilityRequirements: ["knowledge.read"],
    secretBindings: [],
  };
  project.resources["local-composer"] = {
    schemaVersion: "blocky.resource/v1alpha1",
    resourceId: "local-composer",
    kind: "model",
    scope: "project",
    displayName: "Deterministic test composer",
    definition: { implementationRef: "adapter://deterministic/composer-v1" },
    capabilityRequirements: [],
    secretBindings: [],
  };
  project.manifest.resources = Object.values(project.resources).map(
    (resource) => ({
      resourceId: resource.resourceId,
      kind: resource.kind,
      scope: resource.scope,
      definitionRef: `resources/${resource.resourceId}.json`,
      secretRefs: [],
    }),
  );
  project.schemas = {
    "schemas/question.json": { type: "string" },
    "schemas/query.json": { type: "string" },
    "schemas/citations.json": { type: "array" },
    "schemas/answer.json": { type: "object" },
    "schemas/cited-answer.json": { type: "object" },
  };
  return project;
}

export function createKnowledgeIngestionScenario(projectId: string): Project {
  const project = knowledgeProject(projectId);
  project.manifest.format.minimumReaderVersion = "0.8.0";
  let next: WorkspaceBlock | undefined = {
    type: "core.output.structured",
    id: "ingest-result",
    fields: { SCHEMA: "schemas/answer.json" },
  };
  const stages = ["source", "parse", "chunk", "sync", "embed", "index"];
  for (const stage of stages.reverse()) {
    next = {
      type: `core.knowledge.${stage}`,
      id: `ingest-${stage}`,
      fields: {
        RESOURCE: "product-handbook",
        ...(["chunk", "sync"].includes(stage)
          ? { SIZE: "768", OVERLAP: "64" }
          : {}),
        ...(stage === "embed"
          ? { MODEL: "multilingual-e5-small-int8-v1" }
          : {}),
      },
      ...(next ? { next: { block: next } } : {}),
    };
  }
  const root = project.workspaces["research-agent"].blocks.blocks[0];
  root.inputs!.BODY.block!.next = { block: next! };
  return project;
}

export function createKnowledgeCorrectionScenario(projectId: string): Project {
  const project = knowledgeProject(projectId);
  project.manifest.format.minimumReaderVersion = "0.8.0";
  const model = createAgentExample(projectId).resources["agent-model"];
  project.resources = {
    "product-handbook": project.resources["product-handbook"],
    "agent-model": model,
  };
  project.manifest.resources = project.manifest.resources.filter(
    (resource) => resource.kind === "knowledge",
  );
  project.manifest.resources.push({
    resourceId: model.resourceId,
    kind: "model",
    scope: "project",
    definitionRef: "resources/agent-model.json",
    secretRefs: [],
  });
  const root = project.workspaces["research-agent"].blocks.blocks[0];
  root.inputs!.BODY.block!.next = {
    block: {
      type: "core.knowledge.correct",
      id: "check-evidence",
      fields: {
        RESOURCE: "product-handbook",
        MODEL: "agent-model",
        MAX_REWRITES: "1",
      },
      next: {
        block: {
          type: "core.output.answer",
          id: "reply-answer",
          fields: { STYLE: "段落" },
        },
      },
    },
  };
  return project;
}
