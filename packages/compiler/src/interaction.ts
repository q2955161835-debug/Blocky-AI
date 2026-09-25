import {
  diagnostic,
  type Project,
  type ModuleIR,
  type InteractionManifest,
  type ToolContract,
  type Diagnostic,
} from "@blocky/language-schema";
import { resolveResource, implementationKey } from "@blocky/resource-registry";
import { walkNodes } from "./nodes";
export function projectInteraction(
  project: Project,
  modules: ModuleIR[],
  userRegistry = new Map<string, import("@blocky/language-schema").Resource>(),
) {
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
      if (
        ["core.interaction.chat", "core.interaction.chat_entry"].includes(
          node.blockType,
        )
      ) {
        const standalone = node.blockType === "core.interaction.chat_entry" &&
          m.roots.some((root) => root.nodeId === node.nodeId);
        if (!owner && !standalone)
          diagnostics.push(
            diagnostic("BLK-TYPE-006", "聊天入口必须属于智能体或独立模块根", source),
          );
        else
          interaction.entries.push({
            interactionId: node.nodeId,
            moduleId: m.moduleId,
            ownerAgentId: owner ?? node.nodeId,
            displayName:
              typeof node.fields.NAME === "string" && node.fields.NAME.trim()
                ? node.fields.NAME
                : `输入 ${interaction.entries.filter((e) => e.ownerAgentId === (owner ?? node.nodeId)).length + 1}`,
            acceptedParts:
              node.blockType === "core.interaction.chat" ||
              hasTextCapability(node)
                ? ["text"]
                : [],
            exposedSkills: [],
            exposedActions: [],
            executionRequirements: [],
          });
      }
      if (
        [
          "core.knowledge.retrieve",
          "core.model.compose",
          "core.tool.invoke",
        ].includes(node.blockType)
      ) {
        const kind =
          node.blockType === "core.knowledge.retrieve"
            ? "knowledge"
            : node.blockType === "core.tool.invoke"
              ? "tool"
              : "model";
        try {
          const resource = resolveResource(
            project,
            String(node.fields.RESOURCE),
            kind,
            userRegistry,
          );
          if (kind === "tool") {
            const definition = resource.definition;
            const ref = (name: string) => {
              const v = definition[name];
              if (
                !v ||
                typeof v !== "object" ||
                Array.isArray(v) ||
                v.kind !== "schema" ||
                typeof v.id !== "string"
              )
                throw Error();
              const path = `schemas/${v.id}.json`;
              if (!project.schemas[path]) throw Error();
              return path;
            };
            if (definition.version !== "1") throw Error();
            tools.push({
              schemaVersion: "blocky.tool/v1alpha1",
              toolId: `tool-${m.moduleId}-${node.nodeId}`,
              moduleId: m.moduleId,
              displayName: resource.displayName,
              description: "登记的类型化工具",
              inputSchemaRef: ref("inputSchemaRef"),
              outputSchemaRef: ref("outputSchemaRef"),
              permissions: [
                ...new Set([
                  ...resource.capabilityRequirements,
                  ...(definition.permissions as string[]),
                ]),
              ],
              approval: "always",
              implementationRef: implementationKey(
                definition.implementationRef,
              ),
            });
          }
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
              implementationRef: implementationKey(
                resource.definition.implementationRef,
              ),
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
function hasTextCapability(
  node: import("@blocky/language-schema").IrNode,
): boolean {
  let current = node.inputs.CAPABILITIES;
  while (current && !Array.isArray(current)) {
    if (current.blockType === "core.interaction.accept_text") return true;
    current = current.next ?? null;
  }
  return false;
}
