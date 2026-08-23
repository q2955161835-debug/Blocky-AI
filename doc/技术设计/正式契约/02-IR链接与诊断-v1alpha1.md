# IR、跨模块链接与诊断契约 v1alpha1

## 1. 编译边界

每个模块的 Blockly Workspace JSON 独立编译为 `ModuleIR`，再由项目链接器根据稳定导出生成 `ProjectIR`。IR、source map 和诊断都是可重建派生物；保存项目或重新打开时必须从 Workspace 重编译，不能信任磁盘缓存。

## 2. 模块与项目 IR

```ts
type IrNode = {
  nodeId: StableId;
  blockType: string;
  fields: Record<string, JsonValue>;
  inputs: Record<string, IrNode | IrNode[] | null>;
  next?: IrNode;
};

type ModuleIR = {
  schemaVersion: "blocky.module-ir/v1alpha1";
  projectId: StableId;
  moduleId: StableId;
  roots: IrNode[];
  exports: ModuleExport[];
  sourceMap: Record<StableId, SourceRef>;
};

type ProjectIR = {
  schemaVersion: "blocky.project-ir/v1alpha1";
  projectId: StableId;
  modules: Array<{ moduleId: StableId; digest: string }>;
  links: ProjectLink[];
};
```

`nodeId` 在模块内唯一并对应原始 `blockId`；`sourceMap` 的键覆盖所有可执行节点。编译器按稳定节点顺序输出根、字段、输入和导出，显示名不参与摘要或解析。

## 3. 跨模块链接

```ts
type ModuleReference = {
  moduleId: StableId;
  exportId: StableId;
};

type ProjectLink = {
  linkId: StableId;
  source: SourceRef & { portId: StableId };
  target: ModuleReference;
  mode: "sync" | "async" | "stream" | "event";
  timeoutMs?: number;
  eventPolicy?: {
    maxInFlight: number;
    cancellation: "propagate" | "isolate";
  };
};
```

解析顺序固定为模块、导出、类型、调用图：

- 引用只由 `moduleId + exportId` 决定；重命名 `displayName` 不改变链接。
- 删除模块或导出会产生可定位诊断，链接器不得按显示名或相似拼写自动重连。
- 同步调用图禁止环；发现环时整个同步链接集合无效，不靠运行时递归上限掩盖。
- `async`、`stream` 或 `event` 形成环时，每条参与链接必须提供正数 `timeoutMs`，并提供 `eventPolicy.maxInFlight` 和取消策略；否则按结构错误拒绝。
- 链接输入输出 Schema 不兼容时拒绝；不得通过静默字符串化绕过类型检查。
- 同项目内的 `linkId` 唯一，来源端口最多拥有一个同步目标；广播必须使用事件语义。

## 4. 诊断

```ts
type Diagnostic = {
  schemaVersion: "blocky.diagnostic/v1alpha1";
  diagnosticId: StableId;
  code: string;
  severity: "info" | "warning" | "error";
  message: string;
  source?: SourceRef;
  related: SourceRef[];
  action?: { commandId: StableId; arguments: JsonValue };
};
```

诊断是“问题”面板和画布错误标记的唯一结构化来源；界面不得解析 `message` 猜测代码或位置。`diagnosticId` 在一次编译中稳定，`related` 顺序必须确定。`action` 只引用统一命令注册表，不能携带可执行代码。

| 代码 | 严重度 | 含义 | 必需来源 |
|---|---|---|---|
| `BLK-LINK-001` | error | 目标模块不存在 | 来源模块与积木 |
| `BLK-LINK-002` | error | 目标导出不存在 | 来源模块与积木 |
| `BLK-LINK-003` | error | 同步调用图禁止环 | 环中全部链接来源 |
| `BLK-LINK-004` | error | 输入输出类型不兼容 | 来源端口与目标导出 |
| `BLK-MIG-001` | error | 项目迁移失败 | 输入文件引用或项目 |

一个根因只产生一个主诊断代码；后续不可验证项不得制造级联错误。正因如此，[缺失导出负例](fixtures/invalid/missing-cross-module-export.json)只预期 `BLK-LINK-002`。

## 5. SourceMap 与消费方

- 编译器创建 `ModuleIR.sourceMap`，链接器只补充 `related` 来源，不修改 source map。
- RuntimeEvent、运行高亮、运行日志和轨迹复用同一 `SourceRef`。
- 语义补丁必须以 `blockId` 定位；若基线摘要变化，补丁失效并重新编译，不能套用旧 source map。
- 日志导出可包含项目相对 `fileRef`，不得暴露不必要的绝对路径。
