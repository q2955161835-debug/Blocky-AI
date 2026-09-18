import { stableId, type Project } from "@blocky/language-schema";
import { knowledgeStarter } from "./knowledge";
import { taskStarter } from "./task";
export type OfficialStarter = {
  id: string;
  displayName: string;
  description: string;
  sampleInput: string;
  steps: string[];
  version: 1;
};
export const officialStarters: OfficialStarter[] = [
  {
    id: "research-companion",
    displayName: "资料问答伙伴",
    description: "从自己的资料中检索原文摘录，逐条核对引用与缺失证据。",
    sampleInput: "我提供的资料如何说明这个研究问题？",
    steps: [
      "在知识来源中添加资料并同步索引。",
      "提出研究问题，逐条打开引用核对原文。",
      "修改角色或检索配置，补充尚未说明的证据。",
    ],
    version: 1,
  },
  {
    id: "code-guide",
    displayName: "代码库讲解助手",
    description: "定位仓库源码的相对路径与行号，沿原文完成阅读任务。",
    sampleInput: "请找出输入校验的源码，供我阅读。",
    steps: [
      "添加锁定仓库来源并同步索引。",
      "检索一个函数或行为，打开路径与行号核对源码。",
      "记录参数、返回值和仍需阅读的调用位置；本流程不运行仓库。",
    ],
    version: 1,
  },
  {
    id: "knowledge-tutor",
    displayName: "知识小老师",
    description: "用引用的学习资料安排阅读、复述与证据自查，不虚构评分。",
    sampleInput: "我应该怎样阅读和复述资料中的这个概念？",
    steps: [
      "添加学习资料并同步索引。",
      "输入想理解的概念，先阅读引用原文。",
      "用自己的话复述，再标出有原文依据和待核实的内容。",
    ],
    version: 1,
  },
  {
    id: "task-helper",
    displayName: "轻量任务助手",
    description:
      "按 JSON 数值计算总工时；可切换为总分钟工具，不访问文件或网络。",
    sampleInput: '{"count":3,"minutes":15}',
    steps: [
      '输入 JSON，例如 {"count":3,"minutes":15}。',
      "默认工时工具计算 count × minutes ÷ 60，输出 0.75，单位为小时。",
      "将调用模块切换到总分钟工具，使用相同接口输出 45，单位为分钟。",
    ],
    version: 1,
  },
];
export function createOfficialStarter(
  id: string,
  projectId = `project-${crypto.randomUUID()}`,
): Project {
  const starter = officialStarters.find((starter) => starter.id === id);
  if (!starter) throw Error("BLK-STARTER-001");
  if (!stableId.test(projectId)) throw Error("BLK-STARTER-002");
  return id === "task-helper"
    ? taskStarter(starter, projectId)
    : knowledgeStarter(starter, projectId);
}
