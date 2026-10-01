import { knowledgeStarter } from "./knowledge";
import { createAgentExample } from "../agent-example";
import type { OfficialStarter } from "./index";
export function correctionStarter(starter: OfficialStarter, projectId: string) {
  const project = knowledgeStarter(starter, projectId);
  project.manifest.format.minimumReaderVersion = "0.8.0";
  const model = createAgentExample(projectId).resources["agent-model"];
  project.resources = {
    "product-handbook": project.resources["product-handbook"],
    "agent-model": model,
  };
  project.manifest.resources = project.manifest.resources.filter(
    (value) => value.kind === "knowledge",
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
