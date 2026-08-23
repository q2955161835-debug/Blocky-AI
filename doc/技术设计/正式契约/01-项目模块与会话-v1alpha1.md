# 项目、模块、会话与迁移契约 v1alpha1

## 1. 边界

`ProjectManifest` 与各模块的 Blockly Workspace JSON 共同构成项目的编辑事实。IR、链接结果、诊断和运行产物均由编辑事实重建；`WorkspaceSessionState` 只描述本机工作台恢复状态，不进入项目包，也不参与项目摘要。

## 2. 项目事实

```ts
type ProjectManifest = {
  schemaVersion: "blocky.project/v1alpha1";
  projectId: StableId;
  displayName: string;
  modules: ModuleDescriptor[];
  resources: ResourceReference[];
  appSurfaces: AppSurfaceReference[]; // 新项目固定 []
  format: { createdWith: string; minimumReaderVersion: string };
};

type ModuleDescriptor = {
  moduleId: StableId;
  displayName: string;
  purpose: "agent" | "automation" | "service" | "rule" | "state-machine" |
    "behavior-tree" | "event-flow" | "data" | "general";
  workspaceRef: string;
  exports: ModuleExport[];
};

type ModuleExport = {
  exportId: StableId;
  displayName: string;
  kind: "agent" | "tool" | "event" | "function" | "interaction" | "data";
  inputSchemaRef?: string;
  outputSchemaRef?: string;
};

type ResourceReference = {
  resourceId: StableId;
  kind: "model" | "knowledge" | "memory" | "tool" | "skill" | "mcp" |
    "guardrail" | "data" | "task";
  scope: "project" | "user";
  definitionRef: string;
  secretRefs: string[];
};

type AppSurfaceReference = {
  surfaceId: StableId;
  manifestRef: string;
};
```

约束：

- `projectId`、`moduleId`、`exportId`、`resourceId` 与 `surfaceId` 是稳定引用；显示名只用于界面。
- `workspaceRef`、Schema 引用和界面清单引用必须是项目相对引用，不能包含 `..`。`ResourceReference.scope: "project"` 时 `definitionRef` 同样使用项目相对路径；`scope: "user"` 时它必须是符合 `StableId` 的本机资源注册 ID。读取器不能根据字符串外观猜作用域，也不能接受 URI 或绝对路径代替声明。
- 新项目的 `appSurfaces` 必须是空数组。只有用户明确要求创建应用页面并接受语义补丁，才可增加 `AppSurfaceReference`。
- 秘密只记录逻辑 `secretRefs`，项目与 Workspace 均不得保存秘密值。
- 删除模块、导出、资源或界面前必须先检查稳定引用，并以诊断暴露破坏影响。

建议项目包布局：

```text
project.json
workspaces/<moduleId>.workspace.json
resources/<resourceId>.json
surfaces/<surfaceId>.json
```

布局是宿主存储约定，不授权前端传入任意绝对路径。

## 3. 本机会话

```ts
type WorkspaceSessionState = {
  schemaVersion: "blocky.workspace-session/v1alpha1";
  projectId: StableId;
  openTabs: Array<{
    tabId: StableId;
    kind: "canvas" | "browser";
    targetId: StableId;
    order: number;
  }>;
  activeTabId?: StableId;
  bottomPanel: {
    visible: boolean;
    activeView: "problems" | "run-log" | "terminal" | "output";
    heightPx: number;
    maximized: boolean;
    filters: Record<string, JsonValue>;
  };
  canvasViews: Array<{
    tabId: StableId;
    viewport: { offsetX: number; offsetY: number; scale: number };
  }>;
  browserViews: Array<{
    tabId: StableId;
    viewport: { widthPx: number; heightPx: number; scale: number };
    scroll: { x: number; y: number };
  }>;
  terminalLayout: {
    direction: "single" | "horizontal" | "vertical";
    sessionIds: StableId[];
    activeSessionId?: StableId;
  };
};
```

- 会话存入本机应用数据目录，按 `projectId` 隔离，不随项目导出、提交或分享。
- `canvas.targetId` 必须引用既有 `moduleId`；`browser.targetId` 必须引用既有 `surfaceId`。
- 关闭标签只更新会话，不删除模块、Workspace 或 AppSurface。
- 恢复时找不到目标的标签应被跳过并产生信息级诊断，不能按显示名猜测。
- 浏览器标签只能打开已存在的 AppSurface，不能因打开标签而凭空创建页面。
- `order` 从零开始且在同一会话中唯一；无有效活动标签时省略 `activeTabId`。
- `canvasViews` 与 `browserViews` 以 `tabId` 关联已打开标签；关闭标签时同时清除其视口状态。缩放必须为正数，浏览器视口尺寸必须为正整数。
- `terminalLayout` 只保存会话 ID 的布局和焦点，不保存 PTY 句柄、命令历史、输入、输出或环境值；找不到的会话 ID 在恢复时丢弃。
- `bottomPanel.filters` 只保存 JSON 可序列化的视图筛选条件；`maximized`、筛选、终端布局和浏览器视口都属于本机会话，不进入项目事实。

## 4. 单工作区迁移

```ts
type SingleWorkspaceMigrationResult = {
  fromVersion: string;
  toVersion: "blocky.project/v1alpha1";
  project: ProjectManifest;
  createdModuleId: StableId;
  diagnostics: Diagnostic[];
  sourceDigest: string;
};
```

迁移器接收只读旧快照，以规范 JSON 摘要标识输入；相同输入和迁移器版本必须产生相同项目、模块 ID 与诊断顺序。默认创建一个 `purpose: "general"` 的模块，除非旧格式存在可无歧义映射的语义。

迁移是显式命令：先完整验证内存结果，再原子写入新目标；失败不得写入部分项目，也不得修改输入。Windows Core 尖峰快照不是 `blocky.project/v1alpha1`，正式产品禁止跳过迁移直接打开。迁移失败使用 `BLK-MIG-001`。

## 5. 验证次序

1. 验证版本和公共类型。
2. 验证稳定 ID、相对引用和集合唯一性。
3. 验证 Workspace、资源与 AppSurface 文件存在。
4. 验证导出及跨对象引用。
5. 独立加载本机会话；会话损坏不应损坏项目事实。

正例见 [最小多模块项目夹具](fixtures/valid/minimal-multi-module-project.json)。
