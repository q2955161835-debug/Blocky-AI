import type { WorkspaceBlock } from "@blocky/language-schema";
import { knowledgeStarter } from "./knowledge";
import type { OfficialStarter } from "./index";
export function ingestionStarter(starter: OfficialStarter, projectId: string) {
  const project = knowledgeStarter(starter, projectId);
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
  root.fields = {
    ROLE: "更新已授权知识来源。预览只展示样本；同步成功后原子发布完整索引。",
  };
  root.inputs!.BODY.block!.next = { block: next! };
  return project;
}
