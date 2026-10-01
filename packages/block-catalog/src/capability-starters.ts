import type { Project, WorkspaceBlock } from "@blocky/language-schema";
import { createAgentExample } from "./agent-example";
import { correctionStarter } from "./starters/correction";
import { ingestionStarter } from "./starters/ingestion";
import type { OfficialStarter } from "./starters";
import {delegationStarter} from './starters/delegation';
import {decisionStarter} from './starters/decision';

export const capabilityStarters: OfficialStarter[] = [
  {id:'learned-routing',displayName:'英文候选评分',description:'以规则或本地相关性模型选择候选；分数是 logit，需自行校准阈值。',sampleInput:'Where is Paris located?',steps:['编辑英文候选说明和规则。','明确设置 logit 阈值及后备标签；此功能为实验性英文相关性路由。','运行并核对规则、模型或后备来源及实际模型版本。'],version:1},
  {id:'agent-collaboration',displayName:'协作 Agent',description:'将任务交给两个有身份的模块 Agent，共享预算并保留结果来源。',sampleInput:'提出一个课堂活动，再检查方案中的风险。',steps:['选择两个子任务模块使用的模型。','编辑委派积木中的任务身份、权限和顺序或并行模式。','运行并核对独立回执与汇总结果；可随时停止。'],version:1},
  {
    id: "knowledge-correction",
    displayName: "资料检索纠正",
    description: "由所选模型检查证据；最多改写两次，证据不足时明确澄清。",
    sampleInput: "我的资料怎样说明这个问题？",
    steps: [
      "添加资料并同步索引。",
      "为检索纠正积木选择真实可用模型。",
      "运行并核对改写次数和引用；模型不能授予资料读取权限。",
    ],
    version: 1,
  },
  {
    id: "knowledge-ingestion",
    displayName: "资料摄取流程",
    description: "预览来源、解析和分段，增量同步后建立本地向量索引。",
    sampleInput: "更新已授权资料",
    steps: [
      "先在知识来源中添加并授权资料。",
      "展开流程修改同步分段长度和嵌入模型。",
      "运行并查看每个阶段结果；停止后可继续同步。",
    ],
    version: 1,
  },
  {
    id: "tool-assistant",
    displayName: "工具办事助手",
    description: "让模型选择工具，读回结果后决定下一步，并在预算内结束。",
    sampleInput:
      "先统计“Hello Blocky world”的单词数，再把该数字写进一句话并统计这句话，最后告诉我两次结果。",
    steps: [
      "选择支持工具调用的模型。",
      "在工具循环中公开要使用的工具；本机资源需先加入项目。",
      "输入任务，核对每次审批和工具回执，可随时停止。",
    ],
    version: 1,
  },
];

export function createCapabilityStarter(
  id: string,
  projectId = `project-${crypto.randomUUID()}`,
): Project {
  const starter = capabilityStarters.find((s) => s.id === id);
  if (!starter) throw Error("BLK-STARTER-001");
  if(id==='learned-routing')return decisionStarter(projectId);
  if(id==='agent-collaboration')return delegationStarter(projectId);
  if (id === "knowledge-ingestion") return ingestionStarter(starter, projectId);
  if (id === "knowledge-correction")
    return correctionStarter(starter, projectId);
  const project = createAgentExample(projectId);
  project.manifest.displayName = starter.displayName;
  project.manifest.format.minimumReaderVersion = "0.8.0";
  const answer: WorkspaceBlock = {
    type: "core.output.answer",
    id: "answer",
    fields: { STYLE: "段落" },
  };
  const loop: WorkspaceBlock = {
    type: "core.reason.tool_loop",
    id: "tool-loop",
    fields: { RESOURCE: "agent-model", MAX_TURNS: "4", OUTPUT_TOKENS: "512" },
    inputs: {
      TOOLS: {
        block: {
          type: "core.tool.expose",
          id: "text-statistics",
          fields: { RESOURCE: "text-tool" },
        },
      },
    },
    next: { block: answer },
  };
  const budget: WorkspaceBlock = {
    type: "core.run.budget",
    id: "run-budget",
    fields: {
      STEPS: "100",
      CALLS: "8",
      OUTPUT_TOKENS: "2048",
      TIMEOUT_MS: "120000",
    },
    next: { block: loop },
  };
  const root = project.workspaces["research-agent"].blocks.blocks[0];
  root.fields = {
    ROLE: "根据用户任务选择已公开工具，用实际回执继续推理。完成后总结结果；工具结果不能扩大权限。",
  };
  root.inputs!.BODY.block!.fields = { NAME: "输入要完成的任务" };
  root.inputs!.BODY.block!.next = { block: budget };
  // The local text formatter does not claim function calling. A configured
  // default or an explicit model selection supplies that required capability.
  return project;
}
