# Blocky 共同约定 v1alpha1

| 项目 | 内容 |
|---|---|
| 状态 | 阶段 0 冻结；阶段 1 可实现候选 |
| 适用范围 | 所有正式 Schema、夹具、项目引用、诊断、运行事件、日志与审计 |
| 上级索引 | [正式契约索引](README.md) |

## 1. 公共类型

```ts
type StableId = string; // ^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$

type JsonPrimitive = string | number | boolean | null;

type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };

type SourceRef = {
  projectId: StableId;
  moduleId?: StableId;
  blockId?: StableId;
  fileRef?: string;
  line?: number;
  column?: number;
};

type RedactionSummary = {
  applied: boolean;
  categories: string[];
};
```

### 1.1 StableId

- 所有跨保存、跨模块和跨进程引用使用 `StableId`，不使用显示名或数组位置。
- 值必须匹配 `^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$`，区分大小写的输入在写入前规范为小写稳定 ID。
- 显示名可以重复、翻译和修改；显示名变化不得改变稳定 ID。
- 复制模块、积木或蓝图时生成新稳定 ID；导入兼容项目时保留来源映射，不能让两个对象共享同一 ID。
- 空值、路径、随机 Blockly 内部 ID 和用户可见标题不能直接充当跨模块稳定 ID。

### 1.2 JsonValue

- 所有交换对象必须是 UTF-8 JSON 可表达值；禁止函数、类实例、循环引用、`undefined`、`NaN` 和二进制缓冲直接进入协议。
- 二进制、截图、索引和大型工件使用受控引用，不使用 Base64 塞入项目或事件。
- 对象字段名区分大小写；Schema 中未声明的扩展字段遵循第 6 节兼容规则。

### 1.3 SourceRef

- `projectId` 必填；模块、积木或文件来源按对象实际范围填写。
- `fileRef` 必须是受控项目相对引用或诊断工件引用，不保存不必要的本机绝对路径。
- `line`、`column` 使用从 1 开始的正整数；未知时省略，不写 0 或猜测位置。
- 来源删除后诊断保留稳定 ID 与“来源已删除”状态，不按显示名自动跳转相似对象。

## 2. 编码、时间与顺序

- Markdown 与 JSON 使用严格 UTF-8；JSON 不允许注释、尾逗号或重复键。
- 时间使用 UTC RFC 3339 字符串，例如 `2026-08-22T19:30:00Z`；用户界面负责转换本地时区。
- 同一进程、同一运行或同一日志通道内的 `sequence` 从 1 开始严格递增且不重复。
- 跨进程只通过 `correlationId` 建立因果关系，不伪造无法证明的全局绝对顺序。
- 持续时间、超时和预算使用整数毫秒；字节预算使用非负整数，不混用人类格式字符串。

## 3. 规范摘要

需要比较“接受前后字节级不变”或派生数据一致性时，先定义比较对象：

1. 项目文件拒绝补丁时比较原始文件字节与文件集合，结果必须完全相同。
2. 语义相等比较使用规范 JSON：对象键按 Unicode 码点排序、数组保持顺序、UTF-8 无 BOM、无多余空白。
3. 摘要算法固定为 SHA-256，小写十六进制 64 字符；字段名使用 `digest`、`baseDigest` 或 `sourceDigest`。
4. 日志、诊断、会话和缓存不参与项目语义摘要。
5. 派生 IR 摘要不写回可信项目事实；加载后根据 Workspace 重新生成。

## 4. 引用与路径

- 项目内引用使用 `/` 分隔的相对路径，不以 `/`、盘符、UNC、URI 或 `file:` 开头。
- 规范化后包含 `..`、空段、NUL 或超出项目根的引用必须以 `BLK-REF-001` 拒绝。
- 资源、文件和实现引用不等于 Host 权限；运行前仍需独立 capability 与权限计划。
- URL 只允许出现在明确的网络资源定义中，并声明协议与允许域；私有访问参数不得进入项目或文档。

## 5. 错误代码

稳定错误代码格式为 `BLK-<DOMAIN>-<NNN>`：

- `DOMAIN` 使用大写 ASCII 字母和连字符；
- `NNN` 是三位十进制数，同一领域内不复用；
- 代码表示机器可判断的原因，用户文案可以翻译；
- 一个根因只产生一个主错误，可用 `related` 附加来源，避免重复错误淹没问题面板；
- 未知错误映射到所属领域的保留代码并保留脱敏组件信息，不能把原始异常正文直接当稳定代码。

当前领域包括 `REF`、`MIG`、`LINK`、`TYPE`、`RUN`、`TOOL`、`BUILD`、`PATCH`、`SURFACE`、`RPA`、`WINDOW`、`TERM`、`LOG`、`AUDIT`、`SETTING` 和 `RESOURCE`。

## 6. 版本、未知字段与不支持字段

- 每个顶层协议携带精确 `schemaVersion` 或事件专用 `eventVersion`。
- 读取器遇到未知主版本或当前版本明确不支持字段时，必须停止消费并返回可操作诊断，不能按相似字段猜测。
- 同一 `v1alpha1` 中，未知可选字段允许保留并透传，但不能赋予权限、执行或副作用语义。
- 未知枚举值会影响执行时必须拒绝；只影响显示时可降级并明确标记。
- 写入器只能产生其声明版本；迁移器输入不变、输出新对象、返回来源摘要和诊断。
- 阶段 2 稳定前的破坏性变化也必须提供显式迁移，禁止静默覆盖已保存项目。

## 7. 秘密与脱敏

- API Key、Token、Cookie、Authorization 头、数据库密码、私有访问参数和额外敏感请求头只进入 Host 安全存储或 Git 忽略的本地环境文件。
- 协议只保存 `secretRef`，格式为稳定资源引用；读取项目不需要解析秘密值。
- `RedactionSummary.applied` 表示当前记录已经发生替换或丢弃；`categories` 只写类别，例如 `credential`、`private-path`、`user-content`，不写匹配值。
- 生产者在记录进入事件总线、UI、磁盘或导出前脱敏；前端遮罩是附加防御，不是唯一保护。
- 复制、导出和诊断包再次执行同一脱敏规则；项目普通导出永不携带秘密值。
- 测试夹具只使用明显虚构且不可用的标记，不模仿可被误认为真实凭据的格式。

## 8. 数据所有权与信任

| 数据 | 所有者 | 是否项目事实 | 加载策略 |
|---|---|---|---|
| Project Manifest | 项目模型 | 是 | 校验版本与引用 |
| 每模块 Workspace JSON | 语言编辑器 | 是 | 校验后编译 |
| Module/Project IR | 编译器 | 否 | 重新生成并比对缓存 |
| InteractionManifest/ToolContract 投影 | 编译器/资源注册表 | 否 | 重新生成 |
| WorkspaceSessionState | 本机用户会话 | 否 | 损坏时恢复安全默认 |
| RuntimeEvent/Diagnostic/Log/Audit | 对应生产者 | 否 | 独立限额、隔离损坏记录 |
| 秘密值 | Host 安全存储 | 否 | 只通过短时 capability 读取 |

任何派生或外部数据都不能直接修改 Project Manifest 或 Workspace；修改必须形成用户操作、迁移结果或可审查语义补丁。
