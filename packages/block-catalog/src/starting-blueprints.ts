import {
  stableId,
  type Project,
  type WorkspaceBlock,
} from "@blocky/language-schema";
import { knowledgeResource } from "@blocky/knowledge-core";
import { workspaceToolResources } from "./workspace-tools";
import { calculationToolResource } from "./calculation-tool";

export type StartingBlueprintId =
  | "knowledge-assistant"
  | "work-assistant"
  | "coding-assistant"
  | "pi-agent";

export type StartingBlueprint = {
  id: StartingBlueprintId;
  displayName: string;
  create(projectId?: string): Project;
};

const MODEL_RESOURCE_ID = "assistant-model";

function projectShell(projectId: string, displayName: string): Project {
  if (!stableId.test(projectId)) throw Error("BLK-STARTING-BLUEPRINT-001");
  return {
    manifest: {
      schemaVersion: "blocky.project/v1",
      projectId,
      displayName,
      modules: [
        {
          moduleId: "main",
          displayName: "主画布",
          purpose: "agent",
          workspaceRef: "workspaces/main.workspace.json",
          exports: [],
        },
      ],
      resources: [],
      appSurfaces: [],
      format: {
        createdWith: "blocky-desktop/0.8.0",
        minimumReaderVersion: "0.8.0",
      },
    },
    workspaces: { main: { blocks: { languageVersion: 0, blocks: [] } } },
    resources: {},
    schemas: {},
    surfaces: {},
  };
}

function projectIdOrNew(projectId?: string): string {
  return projectId ?? `project-${crypto.randomUUID()}`;
}

function chain(...blocks: WorkspaceBlock[]): WorkspaceBlock {
  for (let i = 0; i < blocks.length - 1; i++)
    blocks[i].next = { block: blocks[i + 1] };
  return blocks[0];
}

function toolDeclarations(resourceIds: string[]): WorkspaceBlock | undefined {
  if (!resourceIds.length) return undefined;
  return chain(
    ...resourceIds.map((resourceId, index) => ({
      type: "core.tool.expose",
      id: `assistant-tool-${index + 1}`,
      fields: { RESOURCE: resourceId },
    })),
  );
}

function toolLoop(
  resourceIds: string[],
  engine: "blocky" | "pi",
): WorkspaceBlock {
  const tools = toolDeclarations(resourceIds);
  return {
    type: "core.reason.tool_loop",
    id: "assistant-tool-loop",
    fields: {
      RESOURCE: MODEL_RESOURCE_ID,
      MAX_TURNS: "8",
      OUTPUT_TOKENS: "512",
      ENGINE: engine,
      SESSION: "conversation",
    },
    ...(tools ? { inputs: { TOOLS: { block: tools } } } : {}),
  };
}

function budget(): WorkspaceBlock {
  return {
    type: "core.run.budget",
    id: "assistant-run-budget",
    fields: {
      STEPS: "100",
      CALLS: "16",
      OUTPUT_TOKENS: "4096",
      TIMEOUT_MS: "120000",
    },
  };
}

function answer(style = "段落"): WorkspaceBlock {
  return {
    type: "core.output.answer",
    id: "assistant-answer",
    fields: { STYLE: style },
  };
}

function installAgent(
  project: Project,
  role: string,
  triggerName: string,
  body: WorkspaceBlock,
): Project {
  project.workspaces.main = {
    blocks: {
      languageVersion: 0,
      blocks: [
        {
          type: "core.agent",
          id: "assistant-root",
          x: 80,
          y: 70,
          fields: { ROLE: role },
          inputs: {
            BODY: {
              block: {
                type: "core.interaction.chat",
                id: "assistant-chat-trigger",
                fields: { NAME: triggerName },
                next: { block: body },
              },
            },
          },
        },
      ],
    },
  };
  return project;
}

function addKnowledgeResource(project: Project): string {
  const resource = knowledgeResource("assistant-knowledge", "我的资料", {
    strategy: "keyword",
    topK: 5,
  });
  project.resources[resource.resourceId] = resource;
  project.manifest.resources.push({
    resourceId: resource.resourceId,
    kind: resource.kind,
    scope: resource.scope,
    definitionRef: `resources/${resource.resourceId}.json`,
    secretRefs: [],
  });
  return resource.resourceId;
}

function createKnowledgeAssistant(projectId?: string): Project {
  const project = projectShell(
    projectIdOrNew(projectId),
    "知识问答助手",
  );
  const knowledgeId = addKnowledgeResource(project);
  const prompt: WorkspaceBlock = {
    type: "core.prompt.context",
    id: "assistant-evidence-instructions",
    fields: {
      TEXT: "只根据已同步资料中的证据回答。未同步、无命中或无权访问时清楚说明，不编造答案或引用。",
    },
  };
  const retrieve: WorkspaceBlock = {
    type: "core.knowledge.retrieve",
    id: "assistant-knowledge-retrieve",
    fields: { RESOURCE: knowledgeId },
  };
  const evidence: WorkspaceBlock = {
    type: "core.guardrail.evidence",
    id: "assistant-evidence-guardrail",
    fields: { POLICY: "require" },
  };
  const compose: WorkspaceBlock = {
    type: "core.model.compose",
    id: "assistant-compose-answer",
    fields: { RESOURCE: MODEL_RESOURCE_ID },
  };
  return installAgent(
    project,
    "根据已同步资料回答问题，引用可核对的原文；资料不足时说明边界。",
    "资料问答",
    chain(prompt, budget(), retrieve, evidence, compose, answer()),
  );
}

function createWorkAssistant(projectId?: string): Project {
  const project = projectShell(projectIdOrNew(projectId), "工作助手");
  const tools = workspaceToolResources(project, [
    "list",
    "search",
    "read",
    "write",
    "undo",
  ]);
  const prompt: WorkspaceBlock = {
    type: "core.prompt.context",
    id: "assistant-work-instructions",
    fields: {
      TEXT: "先检查用户已选择的工作目录，再按任务读取资料、执行必要修改并核对真实回执。数字计算使用计算工具的结果，不用语言模型心算充当核验；生成后读回文件核对内容。只报告已完成的操作；没有可用目录或工具时准确说明缺少哪项配置。",
    },
  };
  const remember: WorkspaceBlock = {
    type: "core.memory.write",
    id: "assistant-remember-delivery",
    fields: { SCOPE: "session", KEY: "last-delivery", SOURCE: "result" },
  };
  return installAgent(
    project,
    "帮助用户完成实际工作任务。使用已声明的工作目录工具，按需检索、读取和保存文件，并准确说明交付结果。",
    "工作任务",
    chain(prompt, budget(), toolLoop([...tools,calculationToolResource(project)], "pi"), remember, answer()),
  );
}

function createCodingAssistant(projectId?: string): Project {
  const project = projectShell(projectIdOrNew(projectId), "Coding 助手");
  const tools = workspaceToolResources(project, [
    "list",
    "search",
    "read",
    "write",
    "undo",
    "check",
  ]);
  const prompt: WorkspaceBlock = {
    type: "core.prompt.context",
    id: "assistant-coding-instructions",
    fields: {
      TEXT: "围绕用户指定的仓库任务，在已选择目录中搜索、读取和修改文件。只运行已声明的检查工具并读取真实结果；失败时依据反馈修正，保留差异和撤销回执。未运行的检查不能报告为通过。",
    },
  };
  return installAgent(
    project,
    "协助用户完成代码任务。只在已选择目录和已声明工具范围内操作；清楚报告变更、实际检查结果和无法完成的步骤。",
    "Coding 任务",
    chain(
      prompt,
      budget(),
      toolLoop(tools, "pi"),
      answer("源码导览"),
    ),
  );
}

function createPiAgent(projectId?: string): Project {
  const project = projectShell(projectIdOrNew(projectId), "Pi Agent");
  const prompt: WorkspaceBlock = {
    type: "core.prompt.context",
    id: "assistant-system-context",
    fields: {
      TEXT: "结合当前会话上下文完成用户任务。仅使用声明并获准的工具；如缺少模型或所需工具，说明具体配置缺口。",
    },
  };
  return installAgent(
    project,
    "你是可配置的通用智能体。理解任务目标，使用真实模型响应和可用上下文给出清晰结果。",
    "Pi Agent 对话",
    chain(prompt, budget(), toolLoop([], "pi"), answer()),
  );
}

export const startingBlueprints = [
  {
    id: "knowledge-assistant",
    displayName: "知识问答助手",
    create: createKnowledgeAssistant,
  },
  {
    id: "work-assistant",
    displayName: "工作助手",
    create: createWorkAssistant,
  },
  {
    id: "coding-assistant",
    displayName: "Coding 助手",
    create: createCodingAssistant,
  },
  { id: "pi-agent", displayName: "Pi Agent", create: createPiAgent },
] as const satisfies readonly StartingBlueprint[];

export function createStartingBlueprint(
  id: string,
  projectId?: string,
): Project {
  const blueprint = startingBlueprints.find((item) => item.id === id);
  if (!blueprint) throw Error("BLK-STARTING-BLUEPRINT-001");
  return blueprint.create(projectId);
}
