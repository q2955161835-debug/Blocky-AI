export type SettingScope = "app" | "project" | "resource" | "block";
export type SettingValues = {
  "ui.reduceMotion": boolean;
  "ui.view": "beginner" | "professional";
  "window.minimizeToTray": boolean;
  "terminal.outputBudgetBytes": number;
  "logs.retentionDays": number;
  "logs.maxStoredBytes": number;
};
export type SettingId = keyof SettingValues;
export type SettingValue = SettingValues[SettingId];
export type SettingValidationRule = {
  ruleId: string;
  kind: "integer" | "minimum" | "maximum" | "one-of";
  argument?: number | readonly string[];
  code: string;
  message: string;
};
export type SettingDefinition = {
  schemaVersion: "blocky.setting/v1alpha1";
  id: SettingId;
  title: string;
  description: string;
  category: string;
  /** Default owning scope. Overrides are permitted only in allowedScopes. */
  scope: SettingScope;
  allowedScopes: readonly SettingScope[];
  valueType: "boolean" | "number" | "enum";
  defaultValue: SettingValue;
  sensitive: boolean;
  requiresRestart: boolean;
  dependsOn: readonly SettingId[];
  conflictsWith: readonly SettingId[];
  migrationVersion: number;
  validationRules: readonly SettingValidationRule[];
};

const base = {
  schemaVersion: "blocky.setting/v1alpha1" as const,
  scope: "app" as const,
  allowedScopes: ["app"] as const,
  sensitive: false,
  requiresRestart: false,
  dependsOn: [],
  conflictsWith: [],
  migrationVersion: 1,
  validationRules: [],
};
function bounds(
  id: string,
  minimum: number,
  maximum: number,
): SettingValidationRule[] {
  return [
    {
      ruleId: `${id}.integer`,
      kind: "integer",
      code: "BLK-SET-INTEGER",
      message: "必须为整数",
    },
    {
      ruleId: `${id}.minimum`,
      kind: "minimum",
      argument: minimum,
      code: "BLK-SET-MINIMUM",
      message: `不能小于 ${minimum}`,
    },
    {
      ruleId: `${id}.maximum`,
      kind: "maximum",
      argument: maximum,
      code: "BLK-SET-MAXIMUM",
      message: `不能大于 ${maximum}`,
    },
  ];
}

const definitions: SettingDefinition[] = [
  {
    ...base,
    id: "ui.reduceMotion",
    title: "减少动态效果",
    description: "关闭呼吸动画，保留状态轮廓和文字",
    category: "外观与无障碍",
    valueType: "boolean",
    defaultValue: false,
  },
  {
    ...base,
    id: "ui.view",
    title: "积木视图",
    description: "选择入门或专业积木分类，不改变项目语义",
    category: "编辑器与画布",
    valueType: "enum",
    defaultValue: "professional",
    validationRules: [
      {
        ruleId: "ui.view.options",
        kind: "one-of",
        argument: ["beginner", "professional"],
        code: "BLK-SET-ENUM",
        message: "请选择入门或专业视图",
      },
    ],
  },
  {
    ...base,
    id: "window.minimizeToTray",
    title: "最小化到通知区域",
    description: "关闭时最小化到任务栏，不改变运行状态",
    category: "窗口与后台",
    valueType: "boolean",
    defaultValue: true,
  },
  {
    ...base,
    id: "terminal.outputBudgetBytes",
    title: "终端输出预算",
    description:
      "新建终端生效；用户终端实际范围 4 KiB–4 MiB，类型化任务采用各自更严格的上限",
    category: "底部面板与终端",
    allowedScopes: ["app", "project"],
    valueType: "number",
    defaultValue: 65536,
    validationRules: bounds("terminal.outputBudgetBytes", 256, 16777216),
  },
  {
    ...base,
    id: "logs.retentionDays",
    title: "日志保留天数",
    description: "本机诊断日志最长保留时间，0 表示不保留历史；不影响审计底线",
    category: "日志与诊断",
    valueType: "number",
    defaultValue: 7,
    validationRules: bounds("logs.retentionDays", 0, 365),
  },
  {
    ...base,
    id: "logs.maxStoredBytes",
    title: "日志存储上限",
    description:
      "同时受 100000 条与 25601024 字节保护上限约束；优先回收普通记录，保留丢弃计数和清除审计",
    category: "日志与诊断",
    valueType: "number",
    defaultValue: 10485760,
    validationRules: bounds("logs.maxStoredBytes", 1024, 1073741824),
  },
];

// Consumers cannot accidentally mutate shared validation/default metadata.
function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
export const settingDefinitions: readonly SettingDefinition[] =
  freeze(definitions);

export function searchSettings(query: string): readonly SettingDefinition[] {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return settingDefinitions.filter((definition) => {
    const haystack = [
      definition.id,
      definition.title,
      definition.description,
      definition.category,
      ...definition.allowedScopes,
    ]
      .join(" ")
      .toLocaleLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}
