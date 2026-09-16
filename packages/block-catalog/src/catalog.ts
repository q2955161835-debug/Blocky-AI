import definitions from "./definitions.json";
export type BlockDefinition = {
  type: string;
  label: string;
  category: number;
  color: string;
  fields: string[];
  inputs: string[];
  fieldOptions?: Record<string, string[]>;
  output?: string;
  statement?: boolean;
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
export const catalog: BlockDefinition[] = definitions;
export const catalogVersion = "0.1.0";
export const getBlock = (type: string) => catalog.find((b) => b.type === type);
