import type { Project, WorkspaceBlock } from "@blocky/language-schema";
import type { OfficialStarter } from "./index";
import { projectShell, moduleDescriptor, mainRoot } from "./shared";
/** Only resource declarations live in the catalog. Host owns grants, documents,
 * indexing and retrieval; the collection intentionally starts empty. */
export function knowledgeStarter(
  starter: OfficialStarter,
  projectId: string,
): Project {
  const project = projectShell(projectId, starter.displayName);
  const style =
    starter.id === "code-guide"
      ? "源码导览"
      : starter.id === "knowledge-tutor"
        ? "知识练习"
        : "条目";
  const role =
    starter.id === "code-guide"
      ? "帮助我定位和阅读源码，只引用已找到的路径、行号和原文；不推断代码已经运行。"
      : starter.id === "knowledge-tutor"
        ? "陪我阅读资料并用自己的话复述，只依据引用原文安排练习，不编造知识点、答案或评分。"
        : "帮助我研究问题，只整理有出处的原文；没有证据的事实保持待核实。";
  const answer: WorkspaceBlock = {
    type: "core.output.answer",
    id: "reply-answer",
    fields: { STYLE: style },
  };
  const compose: WorkspaceBlock = {
    type: "core.model.compose",
    id: "compose-answer",
    fields: { RESOURCE: "local-composer" },
    next: { block: answer },
  };
  const call: WorkspaceBlock = {
    type: "core.knowledge.retrieve",
    id: "call-citation",
    fields: {
      RESOURCE: "product-handbook",
    },
    next: { block: compose },
  };
  project.manifest.modules = [
    moduleDescriptor(
      "research-agent",
      starter.displayName,
      "agent",
      "answer-with-citations",
      "agent",
      "schemas/question.json",
      "schemas/answer.json",
    ),
    moduleDescriptor(
      "citation-service",
      "资料引用服务",
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
      blocks: [mainRoot(role, starter.displayName, call)],
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
    displayName:
      starter.id === "code-guide"
        ? "我的源码资料"
        : starter.id === "knowledge-tutor"
          ? "我的学习资料"
          : "我的研究资料",
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
    displayName: "原文整理",
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
