# 构建、补丁、命令、设置与资源契约 v1alpha1

## 1. Blocky 构建助手协议

构建助手把自然语言意图整理为可审阅需求和语义补丁。它不拥有项目写权限；用户接受且 Host 重新校验后，项目模型才在单一事务中应用补丁。

```ts
type BuildSpec = {
  schemaVersion: "blocky.build/v1alpha1";
  requestId: StableId;
  projectId: StableId;
  baseDigest: string;
  intent: string;
  targetModuleIds: StableId[];
  requiredResources: ResourceReference[];
  requestedCapabilities: string[];
  acceptanceCriteria: string[];
};

type SemanticPatch = {
  schemaVersion: "blocky.patch/v1alpha1";
  patchId: StableId;
  projectId: StableId;
  baseDigest: string;
  catalogVersion: string;
  operations: PatchOperation[];
  permissionDelta: string[];
  diagnostics: Diagnostic[];
};

type PatchOperation =
  | { op: "module.add"; module: ModuleDescriptor }
  | { op: "module.remove"; moduleId: StableId }
  | { op: "block.add" | "block.update" | "block.move" | "block.remove"; moduleId: StableId; blockId: StableId; payload?: JsonValue }
  | { op: "resource.bind"; moduleId: StableId; resourceId: StableId }
  | { op: "app-surface.add"; manifest: JsonValue };
```

流程固定为：编译当前项目并生成 `baseDigest` → 形成 Build Spec → 生成补丁 → 校验目录版本、引用、权限差异和诊断 → 展示幽灵差异 → 用户接受或拒绝 → Host 对基线和能力重新校验 → 原子应用 → 重编译。

- 拒绝、校验失败或基线摘要变化时，项目字节级不变。
- `app-surface.add` 只有用户需求或显式命令包含应用界面时合法；普通 Agent 请求默认不创建页面。
- 构建助手不能直接写 Workspace JSON，也不能执行任意 Shell；它只能生成版本化 `PatchOperation`，或请求获准的 `TaskDefinition`。
- 补丁以稳定 ID 操作，不按显示名定位；删除前必须提供引用影响和可撤销检查点。
- `permissionDelta` 必须单独展示，接受结构变化不等于接受新增权限。

## 2. 统一命令契约

```ts
type CommandDefinition = {
  schemaVersion: "blocky.command/v1alpha1";
  commandId: StableId;
  category: "file" | "edit" | "view" | "run" | "build" | "window" | "settings" | "help" | "terminal" | "logs";
  label: string;
  defaultShortcuts: string[];
  contexts: string[];
  selection: "none" | "single" | "multiple" | "any";
  danger: "none" | "confirm" | "destructive";
  undo: "not-applicable" | "undoable" | "checkpoint";
};

type PointerGestureDefinition = {
  gestureId: StableId;
  trigger: string;
  context: "canvas" | "block" | "selection" | "tab" | "panel";
  behavior: string;
  suppressBlockDrag: boolean;
  commandId?: StableId;
};
```

菜单栏、下拉菜单、命令中心、快捷键和右键菜单都引用同一 `commandId` 和启用条件，不能各自复制业务逻辑。首批鼠标手势固定如下：

| gestureId | 触发 | 行为 |
|---|---|---|
| `selection.toggle` | `Shift + 左键单击` | 点击模式切换单块多选，且不进入拖拽 |
| `selection.marquee` | 空白处左键拖动 | 框选完全或相交命中的积木，规则由偏好项统一决定 |
| `selection.move` | 拖动已选块 | 移动整个选择集并保持相对位置 |
| `canvas.pan-middle` | 鼠标中键拖动 | 在任何选择状态下平移画布 |
| `canvas.pan-space` | `Space + 左键拖动` | 备用平移，不改变选择 |
| `canvas.zoom-pointer` | 普通滚轮 | 以指针位置为中心缩放 |

单块右键提供编辑、复制、禁用、折叠、查看代码和配置；选择集右键提供组合、对齐、分布、保存为蓝图、复制、禁用和删除；空白画布右键提供粘贴、创建模块引用、整理画布和视图操作。所有危险命令遵守 `danger` 与 `undo`，删除多个积木必须生成一个原子撤销记录。

符合常见编辑器经验的默认键包括：`Ctrl+Z/Y` 撤销/重做、`Ctrl+C/X/V/D` 复制/剪切/粘贴/副本、`Delete` 删除、`Ctrl+A` 当前画布全选、`Ctrl+Shift+P` 命令中心、`Ctrl+S` 保存、`Ctrl+Enter` 运行、`Escape` 取消操作或清除选择、`F` 聚焦选择。快捷键冲突由设置 Schema 报告，不静默覆盖。

## 3. 设置 Schema

```ts
type SettingDefinition = {
  schemaVersion: "blocky.setting/v1alpha1";
  id: string;
  title: string;
  description: string;
  category: string;
  scope: "app" | "project" | "resource" | "block";
  valueType: "boolean" | "number" | "string" | "enum" | "secretRef" | "command";
  defaultValue?: unknown;
  sensitive: boolean;
  requiresRestart: boolean;
  dependsOn?: string[];
  conflictsWith?: string[];
  migrationVersion: number;
  validate(value: unknown): SettingDiagnostic[];
};
```

Schema 是设置 UI、搜索、默认值、作用域继承、重置、导入导出、迁移和测试的唯一事实来源。`valueType: "secretRef"` 只保存安全存储引用；任何普通字符串设置不得承载密钥。

阶段 1 只显示已有真实消费者的设置：窗口最小化/关闭/恢复、工作台标签和底部面板恢复、用户终端输出预算，以及资源 `secretRef` 绑定。尚未实现的 AppSurface、RPA 和 Provider 行为不显示无效开关。发布候选前必须执行最终盘点：从真实命令、资源、积木、Host、适配器和运行时生成能力清单，删除无消费者设置、补齐必要控制并重验默认值、迁移、安全和多平台差异。

## 4. 资源定义

```ts
type ResourceDefinition = {
  schemaVersion: "blocky.resource/v1alpha1";
  resourceId: StableId;
  kind: "model" | "knowledge" | "memory" | "tool" | "skill" | "mcp" |
    "guardrail" | "data" | "task";
  displayName: string;
  definition: JsonValue;
  capabilityRequirements: string[];
  secretBindings: Array<{ fieldId: StableId; secretRef: string }>;
};
```

资源注册表为上下文与输入、模型与推理、知识与检索、记忆与状态、工具与连接、Skills 与能力、流程与协作、安全与护栏、数据与结构等专业积木提供稳定引用。项目积木只保存 `resourceId`；定义可以位于项目或本机注册表，但作用域必须显式，秘密字段只能通过 `secretRef` 绑定。

模型资源至少表达 Provider、端点配置、模型 ID 和能力要求；知识资源表达来源、切分、索引与检索策略；工具、Skill、MCP 与任务表达版本、权限和实现引用；护栏表达输入/输出阶段和失败策略。接口不固定具体供应商，也不固定积木总数。

从 GitHub 开源项目生成自定义积木或蓝图时，官方项目转换 Skill 只产出锁定提交的候选 `ResourceDefinition`、积木 Schema 和补丁；用户审阅权限、依赖、许可证和验证结果后才导入，不能在导入时执行仓库代码。
