# 交互、工具、运行事件与可观察性契约 v1alpha1

## 1. 交互清单与工具

右侧交互区只读取编译生成的 `InteractionManifest`，不得扫描画布推测输入类型、技能或操作。工具由只读注册表绑定具体实现；运行时按权限策略决定是否请求批准。

```ts
type InteractionManifest = {
  schemaVersion: "blocky.interaction/v1alpha1";
  projectId: StableId;
  entries: Array<{
    interactionId: StableId;
    moduleId: StableId;
    ownerAgentId: StableId;
    displayName: string;
    acceptedParts: Array<"text" | "image" | "audio" | "file">;
    exposedSkills: StableId[];
    exposedActions: StableId[];
    executionRequirements: string[];
  }>;
};

type ToolContract = {
  schemaVersion: "blocky.tool/v1alpha1";
  toolId: StableId;
  moduleId: StableId;
  displayName: string;
  description: string;
  inputSchemaRef: string;
  outputSchemaRef: string;
  permissions: string[];
  approval: "never" | "on-risk" | "always";
  implementationRef: string;
};
```

`implementationRef` 只能引用已注册实现或确定性测试适配器，例如 `adapter://deterministic/web-search-v1`。它不是可执行代码、任意文件路径或固定返回值；正式契约禁止沿用尖峰 `{ kind: "mock", result }` 形状。输入输出按 Schema 校验，权限取项目授权和工具声明的交集。

## 2. RuntimeEvent

```ts
type RuntimeEvent = {
  eventVersion: "blocky.event/v1alpha1";
  projectId: StableId;
  moduleId?: StableId;
  runId: StableId;
  sequence: number;
  timestamp: string;
  type: RuntimeEventType;
  blockId?: StableId;
  correlationId?: string;
  data: Record<string, JsonValue>;
  redaction: RedactionSummary;
};
```

`RuntimeEventType` 的 v1alpha1 枚举为：

```ts
type RuntimeEventType =
  | "run.started" | "run.paused" | "run.resumed" | "run.completed"
  | "run.failed" | "run.cancelled"
  | "block.started" | "block.completed" | "block.warning" | "block.failed"
  | "model.started" | "model.chunk" | "model.completed" | "model.failed"
  | "tool.permission-requested" | "tool.started" | "tool.progress"
  | "tool.completed" | "tool.failed"
  | "checkpoint.created" | "checkpoint.restored";
```

- 事件只能由唯一工厂创建；工厂分配进程内单调且不重复的 `sequence`、UTC 时间和脱敏摘要。
- 同一 `correlationId` 关联一次模型/工具调用的开始、进度和结束；它不能替代事件序号。
- `data` 只保留结构化、已脱敏的运行信息。稳定诊断代码写入 `data.code`，界面不得解析异常文本。
- 新事件使用登记过的领域前缀和新名称，不能复用现有名称改变语义。
- 运行完成、失败或取消后不再接受同一 `runId` 的执行事件，只允许日志刷新等非运行产物完成结算。

## 3. 高亮与运行日志投影

```ts
type BlockExecutionVisualState = {
  blockId: StableId;
  state: "idle" | "active" | "warning" | "error";
  label: string;
  icon: "none" | "running" | "warning" | "error";
  outline: "normal" | "thick";
  tone: "neutral" | "green" | "yellow" | "red";
};

type RunLogProjection = {
  runId: StableId;
  eventSequence: number;
  level: "info" | "warning" | "error";
  summary: string;
  source?: SourceRef;
  traceTarget?: { runId: StableId; sequence: number };
};
```

固定投影：

| RuntimeEvent | state/tone/outline | icon/label | 日志级别 |
|---|---|---|---|
| `block.started` | `active/green/thick` | `running/正在运行` | info |
| `block.warning` | `warning/yellow/thick` | `warning/需要注意` | warning |
| `block.failed` | `error/red/thick` | `error/运行错误` | error |
| `block.completed` | `idle/neutral/normal` | `none/已完成` | info |

颜色不是唯一状态：关闭动画、开启高对比度或无法辨色时，粗细、图标和文字仍表达同一状态。状态样式仅绘制覆盖层，不能改变积木尺寸、连接位置或画布布局。

运行高亮、运行日志和运行轨迹必须读取同一批 `RuntimeEvent`：高亮按每个 `blockId` 的最后事件投影；运行日志保持事件顺序；轨迹跳转使用 `runId + sequence`，再经 ModuleIR `sourceMap` 找到模块和积木。三者不得建立独立状态机或解析彼此的展示文本。

## 4. 确定性适配与测试

阶段 1 可注入确定性模型/工具适配器，但适配器仍经过真实 `ToolContract`、权限请求和事件工厂。测试夹具不增加产品字段；同一输入、固定时钟和适配器脚本应产生字段相同的事件序列，时间和摘要由夹具显式提供。

[确定性可观察性夹具](fixtures/valid/deterministic-runtime-observability.json)同时覆盖成功路径、警告和失败路径。
