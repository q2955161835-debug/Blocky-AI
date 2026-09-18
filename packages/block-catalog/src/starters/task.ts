import type {
  Json,
  NumericExpression,
  Project,
  WorkspaceBlock,
} from "@blocky/language-schema";
import type { OfficialStarter } from "./index";
import { mainRoot, moduleDescriptor, projectShell } from "./shared";
function toolRoot(moduleId: string, hours: boolean): WorkspaceBlock {
  const product: NumericExpression = {
    op: "*",
    left: { parameter: "count" },
    right: { parameter: "minutes" },
  };
  const program = {
    schemaVersion: "blocky.expression/v1",
    parameters: ["count", "minutes"],
    expression: hours
      ? { op: "/", left: product, right: { number: 60 } }
      : product,
  };
  return {
    type: "core.tool.entry",
    id: `${moduleId}-entry`,
    x: 80,
    y: 70,
    fields: { EXPORT: "calculate-v1" },
    inputs: {
      BODY: {
        block: {
          type: "core.message.reply",
          id: `${moduleId}-reply`,
          inputs: {
            MESSAGE: {
              block: {
                type: "core.message.create",
                id: `${moduleId}-message`,
                inputs: {
                  CONTENT: {
                    block: {
                      type: "core.data.transform",
                      id: `${moduleId}-calculate`,
                      fields: {
                        NAME: hours ? "总工时（小时）" : "总时长（分钟）",
                        PROGRAM: program as Json,
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
  };
}
export function taskStarter(
  starter: OfficialStarter,
  projectId: string,
): Project {
  const project = projectShell(projectId, starter.displayName);
  const input = "schemas/task-input.json",
    output = "schemas/task-result.json";
  project.schemas = {
    [input]: {
      type: "object",
      properties: {
        count: { type: "number", minimum: -1e9, maximum: 1e9 },
        minutes: { type: "number", minimum: -1e9, maximum: 1e9 },
      },
      required: ["count", "minutes"],
      additionalProperties: false,
    },
    [output]: { type: "number", minimum: -1e9, maximum: 1e9 },
  };
  project.manifest.modules = [
    moduleDescriptor(
      "research-agent",
      "轻量任务",
      "general",
      "task-result",
      "agent",
      input,
      output,
    ),
    moduleDescriptor(
      "citation-service",
      "工时工具（小时）",
      "service",
      "calculate-v1",
      "tool",
      input,
      output,
    ),
    moduleDescriptor(
      "minutes-service",
      "总时长工具（分钟）",
      "service",
      "calculate-v1",
      "tool",
      input,
      output,
    ),
  ];
  const call: WorkspaceBlock = {
    type: "core.module.call",
    id: "call-citation",
    fields: {
      MODULE: "citation-service",
      EXPORT: "calculate-v1",
      INPUT: input,
      OUTPUT: output,
    },
  };
  project.workspaces["research-agent"] = {
    blocks: {
      languageVersion: 0,
      blocks: [
        mainRoot(
          "接收 count 和 minutes 两个有界数值，调用所选工具计算时长；默认单位为小时。",
          "计算总工时 · JSON 输入",
          call,
        ),
      ],
    },
  };
  project.workspaces["citation-service"] = {
    blocks: { languageVersion: 0, blocks: [toolRoot("hours", true)] },
  };
  project.workspaces["minutes-service"] = {
    blocks: { languageVersion: 0, blocks: [toolRoot("minutes", false)] },
  };
  return project;
}
