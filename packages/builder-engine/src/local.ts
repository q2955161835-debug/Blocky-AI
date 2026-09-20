import type {
  BuilderInspection,
  BuilderRequest,
} from "@blocky/builder-protocol";
import type { BuilderGeneration } from "./transport";
/** Explicit offline simulation for development; never labelled a remote model. */
export function localBuilderResponse(
  request: BuilderRequest,
  inspection: BuilderInspection,
): BuilderGeneration {
  const root = inspection.blocks.find((b) => b.type === "core.agent");
  const explanation = inspection.selection
    .map(
      (b) =>
        `${b.id}：${inspection.catalog.find((c) => c.type === b.type)?.label ?? b.type}；字段 ${Object.keys(b.fields).join("、")}。`,
    )
    .join("\n");
  const content: BuilderGeneration["content"] = [
    {
      type: "toolCall",
      id: "draft-local",
      name: "draft",
      arguments: {
        plan: [
          request.intent === "explain"
            ? "说明所选积木"
            : "根据需求调整当前角色，保留已有流程",
        ],
        acceptanceCriteria: ["候选编译无错误"],
        ...(request.intent === "explain"
          ? { explanation: explanation || "未选择积木。请选择需要解释的积木。" }
          : {}),
      },
    },
  ];
  if (
    request.intent === "repair" ||
    request.createSurface ||
    (!root && request.intent !== "explain")
  )
    throw Error("BLK-BUILDER-LOCAL-LIMIT");
  if (request.intent !== "explain")
    content.push(
      {
        type: "toolCall",
        id: "patch-local",
        name: "patch",
        arguments: {
          operations: [
            {
              op: "block.update",
              moduleId: request.moduleId,
              blockId: root!.id,
              payload: { fields: { ROLE: request.prompt } },
            },
          ],
        },
      },
      { type: "toolCall", id: "verify-local", name: "verify", arguments: {} },
    );
  return {
    content,
    provider: "deterministic",
    model: "local-builder-v1",
    requestId: "local-response",
    transport: "local",
    usage: null,
  };
}
