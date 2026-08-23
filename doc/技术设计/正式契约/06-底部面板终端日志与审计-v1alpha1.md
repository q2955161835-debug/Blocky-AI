# 底部面板、终端、日志与审计契约 v1alpha1

## 1. 职责分离

```text
编译/配置/权限检查 → Diagnostic → 问题
运行时事实 → RuntimeEvent → 运行日志投影 → 运行轨迹
组件诊断 → LogEnvelope → 输出通道 / 本地诊断存储
高风险决定与外部副作用 → AuditRecord → 权限记录 / 脱敏诊断包
```

日志不进入项目事实。UI 不解析普通字符串猜积木、运行或权限状态；每一层只消费其结构化协议。

## 2. 底部面板

```ts
type BottomPanelViewState = {
  visible: boolean;
  activeView: "problems" | "run-log" | "terminal" | "output";
  heightPx: number;
  maximized: boolean;
  filters: Record<string, JsonValue>;
};
```

四个 view ID 固定为 `problems`、`run-log`、`terminal`、`output`。面板状态属于 `WorkspaceSessionState` 的本机扩展，不写项目。以下是互不替代的独立命令：

- `view.toggleBottomPanel`：只显示或隐藏面板。
- `view.showProblems`：显示问题并激活问题视图。
- `view.showRunLog`：显示面板并激活运行日志。
- `terminal.create`：经 Host 创建用户终端会话。
- `terminal.stop`：停止指定用户终端或具名任务。
- `logs.clearView`：清除当前投影，不删除持久诊断。
- `logs.clearStoredDiagnostics`：显式清除本机诊断存储，并记录清除摘要。

隐藏、关闭或折叠底部面板不停止运行、终端、预览或 RPA。关闭存在前台任务的终端必须提供返回或终止后关闭的明确选择。

## 3. 用户终端与注册任务

```ts
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

type TaskDefinition = {
  schemaVersion: "blocky.task/v1alpha1";
  taskId: StableId;
  displayName: string;
  source: "project" | "blocky" | "extension";
  command: { executableRef: string; arguments: string[] };
  workingDirectoryRef: string;
  allowedEnvironmentKeys: string[];
  secretRefs: string[];
  timeoutMs: number;
  outputBudgetBytes: number;
  agentPolicy: "deny" | "approval-required" | "allow-scoped";
};

type AgentProcessRequest = {
  requestId: StableId;
  caller: { kind: "builder" | "agent" | "skill" | "extension" | "rpa"; id: StableId };
  taskId: StableId;
  arguments: Record<string, JsonPrimitive>;
  capabilityId: StableId;
  timeoutMs: number;
};
```

`UserTerminalSession` 只能由用户创建，拥有独立 PTY、Shell Profile 和界面生命周期。`AgentProcessRequest` 不含 `terminalSessionId`、PTY 句柄、原始命令字符串、任意 cwd 或环境值；Builder、Agent、Skill、扩展和 RPA 只能请求已注册 `TaskDefinition`，由 Host 校验调用者、参数、能力、目录、时间和输出预算。

Agent 不能附加、读取、写入或继承用户 PTY，也不能读取用户终端输入、历史、环境或输出。越界请求返回 `BLK-TERM-003` 并在产生副作用前拒绝。任务定义随项目保存时是可审查资源，导入后不会自动运行。

## 4. 日志与审计

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

通道必须预先登记 `channelId`、生产者 ID/版本、允许的 `kind`、最小级别、容量和保留上限；扩展不能伪装成核心生产者。顺序使用 UTC 时间和单进程单调 `sequence`，跨进程只用 `correlationId` 聚合，不伪造全局绝对顺序。

管线固定为 `Normalizer → Redactor → bounded in-memory bus → projections/stores`，必须先脱敏后分发。`message`、`attributes`、错误对象、stdout/stderr 摘要、复制内容和导出诊断包都经过同一结构化脱敏；前端遮罩只是第二层防护。检测到未脱敏秘密返回 `BLK-LOG-004`，原记录隔离且不进入总线。

每通道有事件和字节上限、批处理、虚拟列表与丢弃计数。压力下可优先丢弃 `trace/debug`，`warning/error/critical` 和审计元数据不得静默丢失。终端 stdout/stderr 按字节预算截断并产生结构化截断记录，不能因记录日志阻塞子进程管道。单条损坏记录被隔离并生成诊断，不得阻止项目打开。

## 5. 保留、清除与导出

| 保留类 | 默认边界 | 清除与导出 |
|---|---|---|
| `ephemeral` | 当前视图会话 | 关闭相关会话后回收 |
| `session` | 当前应用会话 | 正常退出回收，崩溃恢复只保留必要摘要 |
| `diagnostic` | 本机有界天数和磁盘上限 | 用户可清除；复制和导出再次脱敏 |
| `audit` | 本机有界周期 | 清除动作自身记录元数据；企业集中保留另行版本化 |

项目导出默认排除日志、运行轨迹、终端历史和审计。诊断包只能由用户显式选择项目、时间、通道和数据类别，导出版本、错误代码、脱敏记录及必要环境摘要；默认不包含 Prompt、完整模型正文、文件内容、终端输入、环境变量值、HTTP 正文、Cookie、验证码或 RPA 原始截图。

## 6. 生命周期结算

通知区域隐藏不执行退出结算。真正退出必须验证以下对象全部归零：用户 PTY、注册任务进程和进程组、Agent 进程工具、管道、日志刷新器、文件句柄、预览服务、托管运行时、RPA 会话、监听端口和项目文件锁。

退出流程先停止接受新请求，再按依赖顺序取消、刷新、关闭和复核；超时或残留会话产生可操作错误并停留在退出确认状态，不能伪报 `exited`。崩溃恢复只读取边界明确的本地会话摘要，不恢复交互式终端输入或秘密。

安全负例见 [Agent 附加用户终端](fixtures/invalid/agent-attaches-user-terminal.json)与[未脱敏日志](fixtures/invalid/secret-in-log-envelope.json)。
