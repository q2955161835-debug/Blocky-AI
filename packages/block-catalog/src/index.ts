export type BlockDefinition = {
  type: string;
  label: string;
  category: number;
  color: string;
  fields: string[];
  inputs: string[];
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
export const catalog: BlockDefinition[] = [
  {
    type: "core.agent",
    label: "智能体",
    category: 1,
    color: "#7660c9",
    fields: ["ROLE"],
    inputs: ["BODY"],
  },
  {
    type: "core.interaction.chat",
    label: "收到问题",
    category: 0,
    color: "#cc8a18",
    fields: ["NAME"],
    inputs: [],
    statement: true,
  },
  {
    type: "core.module.call",
    label: "调用模块",
    category: 8,
    color: "#b55c91",
    fields: ["MODULE", "EXPORT", "INPUT", "OUTPUT"],
    inputs: [],
    statement: true,
  },
  {
    type: "core.model.compose",
    label: "组织回答",
    category: 3,
    color: "#5178ce",
    fields: ["RESOURCE"],
    inputs: [],
    statement: true,
  },
  {
    type: "core.output.answer",
    label: "回答",
    category: 11,
    color: "#45997e",
    fields: ["STYLE"],
    inputs: [],
    statement: true,
  },
  {
    type: "core.tool.entry",
    label: "工具入口",
    category: 6,
    color: "#418eac",
    fields: ["EXPORT"],
    inputs: ["BODY"],
  },
  {
    type: "core.knowledge.retrieve",
    label: "查找资料",
    category: 4,
    color: "#4f9c86",
    fields: ["RESOURCE"],
    inputs: [],
    statement: true,
  },
];
export const catalogVersion = "0.1.0";
export const getBlock = (type: string) => catalog.find((b) => b.type === type);
