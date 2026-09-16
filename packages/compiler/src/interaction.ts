import {
  diagnostic,
  type Project,
  type ModuleIR,
  type InteractionManifest,
  type ToolContract,
  type Diagnostic,
} from "@blocky/language-schema";
import { resolveResource } from "@blocky/resource-registry";
import { walkNodes } from "./nodes";
export function projectInteraction(project: Project, modules: ModuleIR[]) {
  const interaction: InteractionManifest = {
    schemaVersion: "blocky.interaction/v1alpha1",
    projectId: project.manifest.projectId,
    entries: [],
  };
  const tools: ToolContract[] = [],
    diagnostics: Diagnostic[] = [];
  for (const m of modules)
    for (const { node, owner } of walkNodes(m.roots)) {
      const source = m.sourceMap[node.nodeId];
      if (node.blockType === "core.interaction.chat") {
        if (!owner)
          diagnostics.push(
            diagnostic("BLK-TYPE-006", "聊天入口必须属于智能体", source),
          );
        else
          interaction.entries.push({
            interactionId: node.nodeId,
            moduleId: m.moduleId,
            ownerAgentId: owner,
            displayName: String(node.fields.NAME),
            acceptedParts: ["text"],
            exposedSkills: [],
            exposedActions: [],
            executionRequirements: [],
          });
      }
      if (
        ["core.knowledge.retrieve", "core.model.compose"].includes(
          node.blockType,
        )
      ) {
        const kind =
          node.blockType === "core.knowledge.retrieve" ? "knowledge" : "model";
        try {
          const resource = resolveResource(
            project,
            String(node.fields.RESOURCE),
            kind,
          );
          if (kind === "knowledge")
            tools.push({
              schemaVersion: "blocky.tool/v1alpha1",
              toolId: `tool-${m.moduleId}-${node.nodeId}`,
              moduleId: m.moduleId,
              displayName: resource.displayName,
              description: "检索带来源的资料",
              inputSchemaRef: "schemas/query.json",
              outputSchemaRef: "schemas/citations.json",
              permissions: [
                ...new Set([
                  "knowledge.read",
                  ...resource.capabilityRequirements,
                ]),
              ],
              approval: "never",
              implementationRef: String(resource.definition.implementationRef),
            });
        } catch {
          diagnostics.push(
            diagnostic("BLK-RESOURCE-001", "资源不存在或类型不匹配", source),
          );
        }
      }
    }
  return { interaction, tools, diagnostics };
}
