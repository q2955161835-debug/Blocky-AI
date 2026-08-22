# Blocky 底部面板、终端与日志系统设计

| 项目 | 内容 |
|---|---|
| 版本 | v0.1 |
| 日期 | 2026-08-23 |
| 状态 | 已接受为产品规划基线；阶段 0 冻结契约，阶段 1–2 实现最小纵切与正式地基 |
| 适用范围 | Blocky Studio 底部面板、问题、运行日志、输出、终端、诊断、审计与日志导出 |

## 1. 设计目标

Blocky Studio 需要同时照顾第一次搭建 Agent 的普通用户和需要排查真实工程问题的开发者。底部面板提供靠近画布、可随时收起的专业工作区，但不能把内部调试噪声直接倾倒给用户，也不能让内置 Agent 借终端绕过 Blocky 的权限和语义补丁体系。

目标如下：

1. 用户能从积木警告或错误直接定位到“问题”，从运行中的积木直接定位到“运行日志”。
2. 运行日志保持简洁、可筛选、可跳回来源；需要逐步输入输出时再进入“运行轨迹”。
3. 用户主动打开的终端可以执行项目任务；Agent 只能调用独立的受控进程工具，不能读取、接管或复用用户终端会话。
4. 编辑器、Host、构建助手、应用界面预览、RPA、扩展和运行时使用统一日志入口、关联标识和脱敏规则。
5. 日志高吞吐时不阻塞画布和运行时；保留、清除、导出和诊断包都有明确范围。
6. 底部面板的展开、尺寸、标签和筛选条件属于用户会话状态，不进入 Project Manifest、Workspace 或 Project IR。

## 2. 底部面板信息架构

底部面板位于中间工作区下方，可折叠、调整高度、最大化到中间区，也可通过统一命令系统切换。首批固定四个标签：

| 标签 | 面向对象 | 内容 | 不承担的职责 |
|---|---|---|---|
| **问题** | 所有人 | 编译、类型、配置、权限、迁移和跨模块引用诊断 | 不显示连续运行输出 |
| **运行日志** | 所有人 | 当前/历史运行的时间序列摘要、状态、来源和耗时 | 不替代完整运行轨迹 |
| **终端** | 开发者/高级用户 | 用户主动创建的项目终端和白名单任务终端 | 不是 Agent 默认工具，也不保存到项目 |
| **输出** | 开发者/支持人员 | 构建助手、编译器、Host、预览、RPA、扩展等具名通道的诊断输出 | 不显示未脱敏请求正文或秘密 |

### 2.1 默认行为

- 第一次启动时底部面板默认收起；首次出现错误时打开“问题”，首次运行时可按设置打开“运行日志”。
- 面板打开不会缩放或修改 Blockly Workspace；仅改变编辑器布局。
- 点击状态栏的问题数、运行状态或任务状态打开对应标签。
- `Ctrl + J` 切换底部面板；`Ctrl + Shift + M` 打开“问题”；终端使用可重绑定命令，不抢占浏览器/WebView 保留快捷键。
- 关闭标签只隐藏视图；停止运行、终止终端和清除日志是独立命令，必须明确区分。
- 面板中的每个列表支持键盘导航、搜索、级别/来源/运行筛选、复制脱敏内容和跳转来源。

### 2.2 会话与布局

以下信息只保存到本机用户会话：

- 面板是否展开、上次高度和最大化状态；
- 当前标签、日志筛选、选中的运行和输出通道；
- 用户终端的标签顺序与显示名称；
- 是否跟随最新日志、自动换行和时间戳显示偏好。

项目可以声明可执行的具名任务，但不能声明“打开终端”“自动运行命令”或修改用户日志偏好。打开项目不得自动创建进程。

## 3. 问题、运行日志与运行轨迹的边界

### 3.1 问题

“问题”读取版本化 `Diagnostic`：

- 按错误、警告、信息分组；
- 显示模块、积木、资源或文件来源；
- 可执行“跳到积木”“打开配置”“查看影响”“复制诊断代码”；
- 同一根因合并计数，但不得吞掉不同来源；
- 已解决问题从活动列表移除，历史变化只进入诊断会话，不修改项目。

### 3.2 运行日志

“运行日志”是 `RuntimeEvent` 的用户可读投影，不是另一套运行事实源。它按运行、Agent/自动化模块和关联 ID 聚合：

- 开始、暂停、恢复、取消、完成和失败；
- 积木激活、警告、错误和耗时；
- 模型、知识、记忆、工具、护栏、RPA 与输出的脱敏摘要；
- 权限请求、人工确认和恢复检查点；
- 从日志行跳到来源积木、应用界面交互或 RPA 步骤。

运行积木的绿色加粗高亮、黄色警告和红色错误均由同一 `RuntimeEvent` 状态驱动。日志行同时显示图标、文字和状态，不以颜色作为唯一信息。

### 3.3 运行轨迹

“运行轨迹”是结构化调试器，负责事件树、上下文组成、参数、调用关系、断点、单步、回放和前后状态对比。底部“运行日志”只提供高频摘要与跳转入口；展开某条日志的“查看运行轨迹”后，才显示经过权限与脱敏处理的深层数据。

三者关系固定为：

```text
编译/配置/权限检查 → Diagnostic → 问题
运行时事实 → RuntimeEvent → 运行日志投影 → 运行轨迹详情
组件诊断 → LogEnvelope → 输出通道 / 本地诊断存储
高风险授权与外部副作用 → AuditRecord → 权限记录 / 脱敏诊断包
```

禁止让 UI 解析普通字符串日志来猜积木状态、运行结果或权限决定。

## 4. 终端设计

### 4.1 两类执行面必须隔离

| 类型 | 发起者 | 能力 | 数据边界 |
|---|---|---|---|
| `UserTerminalSession` | 用户在“终端”标签主动创建 | 交互式 Shell 或项目具名任务；权限等同用户明确选择的终端配置 | Agent 看不到输入、历史、环境值和输出，除非用户主动复制到对话 |
| `AgentProcessRequest` | 作品 Agent、构建助手、Skill 或自动化 | 版本化工具契约中的白名单任务、受限参数、目录和时间预算 | 经过 Host capability、权限计划、脱敏与审计，不连接用户终端 PTY |

“Blocky 构建助手可以使用验证工具”不等于“可以操作底部终端”。构建助手的 `verify` 只运行注册过的编译、测试和格式化任务；任意 Shell 需要单独设计、授权和沙箱，不能通过向终端写字实现。

### 4.2 用户终端

用户终端首批能力：

- 新建、重命名、拆分、聚焦、清空显示、终止和重新启动会话；
- 选择项目根或用户已授权目录作为工作目录；
- 选择系统发现的 Shell Profile，默认不修改系统 Shell 配置；
- 支持项目具名任务、退出码、运行时长、取消和输出上限；
- 大输出使用环形缓冲与虚拟列表，保留截断提示；
- 关闭含前台任务的终端时明确询问“返回”或“终止任务并关闭”。

终端历史默认由 Shell 自身策略管理。Blocky 不把命令历史写入项目、运行事件、普通日志或诊断包；若未来提供 Blocky 自有历史，必须默认关闭并通过独立安全评审。

### 4.3 项目具名任务

项目可声明 `TaskDefinition`，例如验证、测试、预览或格式化。每项任务必须声明：

- 稳定 `taskId`、用户可见名称和来源；
- 命令模板与类型化参数，禁止字符串拼接未验证输入；
- 工作目录引用、允许的环境变量名和秘密引用；
- 超时、输出上限、并发、取消与退出码语义；
- 是否允许 Agent 请求、是否需要逐次批准以及允许的调用者；
- Windows/macOS 平台差异。

项目任务是可审查资源，不是积木库一级分类。社区蓝图、GitHub 转换器和兼容模板只能提出任务定义差异，不能导入后自动运行。

## 5. 日志领域模型

阶段 0 冻结三个独立协议，避免把所有内容塞进一个字符串文件：

```ts
type LogEnvelope = {
  schemaVersion: "blocky.log/v1alpha1";
  logId: string;
  timestamp: string;
  sequence: number;
  level: "trace" | "debug" | "info" | "warning" | "error" | "critical";
  kind: "diagnostic" | "component" | "terminal" | "preview" | "security";
  channel: string;
  scope: {
    projectId?: string;
    moduleId?: string;
    runId?: string;
    terminalSessionId?: string;
  };
  correlationId?: string;
  source?: { moduleId?: string; blockId?: string; fileRef?: string; line?: number };
  message: string;
  attributes: Record<string, string | number | boolean | null>;
  redaction: { applied: boolean; categories: string[] };
  retentionClass: "ephemeral" | "session" | "diagnostic" | "audit";
};

type TerminalSessionContract = {
  schemaVersion: "blocky.terminal/v1alpha1";
  sessionId: string;
  owner: "user";
  mode: "interactive" | "task";
  profileId: string;
  workingDirectoryRef: string;
  taskId?: string;
  outputBudgetBytes: number;
  timeoutMs?: number;
  status: "starting" | "running" | "stopping" | "exited" | "failed";
};

type AuditRecord = {
  schemaVersion: "blocky.audit/v1alpha1";
  auditId: string;
  timestamp: string;
  actor: { kind: "user" | "builder" | "agent" | "extension"; id: string };
  action: string;
  target: string;
  decision: "allowed" | "denied" | "cancelled" | "failed" | "completed";
  capabilityId?: string;
  correlationId: string;
  summary: string;
  redaction: { applied: boolean; categories: string[] };
};
```

约束：

- `LogEnvelope` 不替代 `RuntimeEvent`、`Diagnostic` 或 `AuditRecord`，只承载统一显示和诊断输出。
- `message` 和 `attributes` 必须在进入日志总线前完成结构化脱敏；前端二次遮罩只作为防御层。
- `fileRef` 是受控项目/诊断引用，不保存不必要的本机绝对路径。
- 时间顺序同时使用 UTC 时间戳和单进程单调 `sequence`；跨进程通过 `correlationId` 聚合，不伪造全局绝对顺序。
- 未知字段由版本策略处理；加载器不能因为一条损坏日志阻止项目打开。

## 6. 日志管线与存储

```text
Runtime / Compiler / Builder / Host / Terminal / Preview / RPA / Extension
            ↓ typed event or structured log
Normalizer → Redactor → bounded in-memory bus
            ├── Problems / Run Log / Output projections
            ├── bounded local diagnostic store
            └── append-only audit metadata store
```

### 6.1 生产者

- 编译器只产出 `Diagnostic`，不直接写 UI。
- 运行时只产出 `RuntimeEvent`；日志投影层生成用户可读行。
- Host、预览服务、终端适配器和扩展使用结构化 Logger，不在生产路径散落 `console.log`。
- Web 前端预览只转发经过隔离与限额的 console、网络摘要和页面错误；不能读取 Blocky 其他项目日志。
- RPA 截图、OCR 文本和录制内容不是普通日志属性，必须使用受控工件引用和更短保留策略。

### 6.2 背压与容量

- UI 使用批处理和虚拟列表；每个通道有内存事件上限与丢弃计数。
- `debug`/`trace` 可优先丢弃，`warning`/`error`/`critical` 和审计元数据不得静默丢失。
- 终端 stdout/stderr 按字节预算截断并显示“已截断”事件；不得因日志阻塞子进程管道。
- 日志写盘失败时降级到有界内存并显示诊断，不能使 Agent 运行或项目保存崩溃。

### 6.3 保留与清除

| 类别 | 默认保留 | 清除行为 |
|---|---|---|
| `ephemeral` | 当前视图会话 | 关闭相关会话后回收 |
| `session` | 当前应用会话 | 正常退出后回收，崩溃恢复只保留必要摘要 |
| `diagnostic` | 本机有界天数与磁盘上限 | 用户可一键清除；导出前再次脱敏 |
| `audit` | 本机有界周期，企业策略后续扩展 | 清除动作本身记录元数据；阶段 11 才支持企业集中保留 |

日志、运行轨迹和审计记录不属于项目编辑事实。项目导出默认不包含它们；用户明确导出诊断包时只包含勾选范围、版本、错误代码、脱敏日志和必要环境摘要。

## 7. 安全与隐私

日志系统在四个入口执行敏感扫描：项目工件、前端日志、Host 日志和导出诊断包。至少覆盖 API Key、Token、Cookie、Authorization 头、私有地址、用户输入、模型正文、联系人、文件内容和 RPA 敏感字段。

- 默认日志不记录 Prompt、模型完整输入输出、文件内容、终端输入、环境变量值、HTTP 正文、Cookie 或验证码。
- 错误对象只保存稳定错误代码、组件、阶段和脱敏摘要；第三方响应正文默认丢弃。
- “复制日志”与“导出诊断包”执行同一服务端/Host 脱敏，不依赖 UI 隐藏字符。
- 终端 ANSI/OSC 转义序列必须过滤危险窗口标题、链接和剪贴板操作；输出不能向 WebView 注入 HTML。
- 扩展日志带来源和版本，不能伪装成 Blocky 核心通道。
- 真正退出时必须结算 PTY、任务进程、日志刷新器和文件句柄；通知区域隐藏不等同退出。

## 8. 设置模板

阶段 0 只冻结字段语义；对应能力实现后才显示设置：

| ID | 作用域 | 候选默认 | 约束 |
|---|---|---|---|
| `bottomPanel.restoreState` | 应用 | `true` | 只保存布局会话，不写项目 |
| `bottomPanel.openOnError` | 应用 | `true` | 可关闭自动打开，但状态栏仍显示问题 |
| `runLog.followLatest` | 应用 | `true` | 用户手动上滚后暂停跟随 |
| `runLog.detailLevel` | 应用/项目 | `normal` | `normal` 不含正文；项目值可覆盖显示，不扩大采集范围 |
| `terminal.defaultProfile` | 应用 | 系统发现值 | 保存 Profile ID，不修改系统默认 Shell |
| `terminal.confirmOnActiveClose` | 应用 | `true` | 有活动任务时不能被项目模板关闭 |
| `terminal.outputBudgetBytes` | 应用/项目 | 有界值 | 必须有产品上限，项目只能收紧或在允许范围内调整 |
| `logs.level` | 应用 | `info` | 正式包默认不持久化 `trace` |
| `logs.retentionDays` | 应用 | 有界值 | 审计和诊断可采用不同上限 |
| `logs.maxDiskBytes` | 应用 | 有界值 | 超限按类别与时间回收并产生摘要 |

不提供“允许 Agent 操作我的终端”“关闭日志脱敏”“记录完整模型正文”或“永久保存所有 RPA 截图”之类普通开关。

## 9. 分阶段落地

| 阶段 | 交付 |
|---|---|
| 阶段 0 | 冻结底部面板会话、`LogEnvelope`、`TerminalSessionContract`、`AuditRecord`、通道、关联、脱敏、保留与退出结算契约 |
| 阶段 1 | 在正式纵切中提供“问题/运行日志/终端/输出”面板壳；确定性运行夹具产生真实 `RuntimeEvent` 投影；终端通过正式 Host 接口运行一个锁定的项目任务夹具，不提供 Demo 专用日志格式 |
| 阶段 2 | 实现统一日志总线、结构化 Logger、底部面板会话恢复、完整用户 PTY、多终端、任务注册、容量/保留/清除和 Host 退出结算 |
| 阶段 3–5 | 接入知识/RAG、GitHub 项目积木化、模型 Provider、构建助手与应用界面预览通道；真实 API 验收前主动请求用户安全配置 |
| 阶段 6 | 完成运行轨迹、断点/单步/回放、上下文与工具详情、脱敏诊断包；运行日志继续作为摘要投影 |
| 阶段 7 | 接入有人值守 RPA 日志、检查点和受控工件，不记录敏感输入 |
| 阶段 8–10 | 接入兼容适配器、CLI、官方 Skills、Codex 插件和教育诊断；保持相同协议 |
| 阶段 11 | 专项设计企业集中审计、无人值守 Worker 日志和保留策略，不复用交互式用户终端权限 |
| 发布候选前 | 盘点通道消费者、默认级别、容量、保留、清除、脱敏、崩溃恢复、诊断导出和多平台 Shell 差异 |

## 10. 人工验收主流程

1. 打开存在编译错误的多模块项目，底部面板自动进入“问题”，点击后定位到准确画布和积木。
2. 修复后运行确定性 Agent，积木高亮与运行日志状态一致；点击日志进入运行轨迹并返回来源。
3. 打开两个用户终端，执行具名任务和长输出任务；验证拆分、取消、截断、退出码和关闭保护。
4. 让构建助手或作品 Agent 请求进程工具，确认它无法读取或操作用户终端，只能走独立授权的 `AgentProcessRequest`。
5. 触发 Provider、应用界面预览、RPA 和扩展错误，按通道筛选并导出诊断包。
6. 在输入中放置模拟密钥、Cookie、私有路径、Prompt 和验证码，确认四目标日志与导出均不泄露。
7. 最小化到通知区域后继续已授权任务，再真正退出；确认 PTY、子进程、日志句柄和预览服务全部结算。

详细流程长期维护在跨模块验收 U19；自动化验收还需覆盖事件顺序、关联、背压、截断、保留、清除、损坏恢复和敏感扫描。
