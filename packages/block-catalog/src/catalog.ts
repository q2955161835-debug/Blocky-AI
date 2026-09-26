import definitions from "./definitions.json";
import textPrimitives from "./text-primitives.json";
import agentPrimitives from "./agent-primitives.json";
import eventPrimitives from "./event-primitives.json";
import flowPrimitives from "./flow-primitives.json";
import workflowPrimitives from "./workflow-primitives.json";
import rpaPrimitives from "./rpa-primitives.json";
import version from "./version.json";
export type BlockDefinition = {
  type: string;
  label: string;
  category: number;
  color: string;
  fields: string[];
  inputs: string[];
  fieldOptions?: Record<string, string[] | undefined>;
  output?: string;
  statement?: boolean;
  statementCheck?: string;
  inputChecks?: Record<string, string | string[] | undefined>;
  requiredInputs?: string[];
  optionalFields?: string[];
  jsonFields?: string[];
};
export const categories = [
  "触发与交互",
  "智能体",
  "指令与上下文",
  "模型",
  "知识库",
  "记忆",
  "工具",
  "技能与扩展",
  "协作与编排",
  "护栏与权限",
  "数据与逻辑",
  "输出与渠道",
];
export const beginnerCategories = [
  "开始",
  "角色",
  "会思考",
  "会查找",
  "会记住",
  "会行动",
  "会回答",
];
export const catalog: BlockDefinition[] = [
  ...definitions,
  ...textPrimitives,
  ...eventPrimitives,
  ...flowPrimitives,
  ...workflowPrimitives,
  ...rpaPrimitives,
  ...agentPrimitives,
];
export const catalogVersion = version.catalogVersion;
export const getBlock = (type: string) => catalog.find((b) => b.type === type);
