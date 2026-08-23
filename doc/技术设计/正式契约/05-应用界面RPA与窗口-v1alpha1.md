# 应用界面、RPA 与窗口契约 v1alpha1

## 1. 工作台与应用界面

中间工作区使用标签承载多个 Agent 画布和浏览器预览。每个模块拥有独立画布，模块间通过稳定 `ProjectLink` 连接，不要求堆在同一画布；浏览器标签只打开项目中已经存在的 AppSurface。新项目 `appSurfaces: []`，普通 Agent 搭建不会隐式生成前端页面。

```ts
type AppSurfaceManifest = {
  schemaVersion: "blocky.app-surface/v1alpha1";
  surfaceId: StableId;
  displayName: string;
  sourceRootRef: string;
  associatedModuleIds: StableId[];
  bridgeRef: string;
  permissions: string[];
  build: { packageManager: "pnpm"; lockfileRef: string; outputRef: string };
};

type FrontendBridgeContract = {
  schemaVersion: "blocky.frontend-bridge/v1alpha1";
  surfaceId: StableId;
  endpoints: Array<{
    endpointId: StableId;
    direction: "invoke" | "subscribe";
    target: ModuleReference;
    inputSchemaRef?: string;
    outputSchemaRef?: string;
    approval: "never" | "on-risk" | "always";
  }>;
};
```

应用界面只能通过最小 Frontend Bridge 调用登记端点，没有 Tauri 全局对象、任意文件或 Shell 能力。每个项目使用隔离的 Cookie、LocalStorage、缓存、Service Worker、权限和预览进程；不允许跨项目共享浏览器状态。

`app-surface.add` 需要 Build Spec 或用户命令明确包含页面意图，先展示源文件、依赖、权限和 Bridge 差异，用户接受后才原子加入项目。拒绝补丁后项目字节级不变。关闭浏览器标签只更新本机会话，不删除源文件或 Manifest；部署是与本地预览分离的独立授权动作。

## 2. 有人值守 RPA

```ts
type RpaModuleContract = {
  schemaVersion: "blocky.rpa/v1alpha1";
  moduleId: StableId;
  mode: "attended";
  applications: Array<{
    applicationId: StableId;
    executableRef?: string;
    browserOrigin?: string;
  }>;
  permissions: string[];
  checkpoints: Array<{
    checkpointId: StableId;
    beforeSideEffect: boolean;
    revalidateExternalState: boolean;
  }>;
};

type RpaLocator = {
  locatorId: StableId;
  strategy: "browser-semantic" | "windows-uia" | "image" | "absolute-coordinate";
  applicationId: StableId;
  selector: JsonValue;
  risk: "normal" | "elevated";
};

type RpaPermissionScope = {
  permissionId: StableId;
  applicationId: StableId;
  windowSelector?: JsonValue;
  targetLocatorIds: StableId[];
  actions: string[];
  dataScopes: string[];
  validUntil: string;
};

type RpaApplicationSession = {
  sessionId: StableId;
  moduleId: StableId;
  applicationIds: StableId[];
  presence: "user-present";
  status: "starting" | "running" | "paused" | "stopping" | "stopped" | "failed";
  capabilityId: StableId;
  expiresAt: string;
};

type RpaSensitiveInputBinding = {
  fieldId: StableId;
  source: "user-present-input" | "secretRef";
  secretRef?: string;
  recording: "excluded";
};

type RpaSideEffectPolicy = {
  actionId: StableId;
  checkpointId: StableId;
  replay: "idempotent" | "compensated" | "never";
  idempotencyKeyRef?: string;
  compensationActionId?: StableId;
};

type RpaTraceContract = {
  runtimeEventVersion: "blocky.event/v1alpha1";
  auditVersion: "blocky.audit/v1alpha1";
  sourceMapRequired: true;
  artifactPolicy: "reference-only";
};

type RpaModuleDefinition = {
  contract: RpaModuleContract;
  permissionScopes: RpaPermissionScope[];
  locators: RpaLocator[];
  sensitiveInputs: RpaSensitiveInputBinding[];
  sideEffectPolicies: RpaSideEffectPolicy[];
  trace: RpaTraceContract;
  session: RpaApplicationSession;
};
```

v1alpha1 只接受 `mode: "attended"`：用户必须在本机可见会话中发起、观察并可随时暂停。每个 `permissions` 条目引用同定义中的 `RpaPermissionScope.permissionId`；Host 同时校验应用、窗口、目标、动作、数据范围、有效期和 session capability。`unattended` 返回 `BLK-RPA-001`，企业 Worker、远程队列和无人值守凭据必须另行版本化和 L3 评审。

定位优先级为浏览器语义、Windows UIA、图像、绝对坐标。绝对坐标只是持续显示 elevated 警告的最后回退；恢复检查点前必须重新验证窗口、页面、记录和外部状态。每个副作用通过 `RpaSideEffectPolicy` 声明幂等、补偿或禁止重放，并在执行前创建 `beforeSideEffect` 检查点。

密码、Token、Cookie、验证码和隐私字段通过 `RpaSensitiveInputBinding` 的用户现场输入或 `secretRef` 解决，不进入录制、截图、OCR、运行轨迹或日志。暂停/恢复/停止复用 `RuntimeEvent` 的 `run.paused/run.resumed/run.cancelled`，每个动作以 source map 定位并通过同一 `correlationId` 关联 RPA 身份的 `AuditRecord`；截图/OCR 只保存有界、脱敏的工件引用。用户终端也不是 RPA 的执行后门；RPA 请求进程任务时仍使用隔离的 `AgentProcessRequest`。

## 3. 窗口生命周期

```ts
type WindowLifecycle = {
  schemaVersion: "blocky.window/v1alpha1";
  state: "visible" | "hidden-notification-area" | "close-confirmation" | "exiting" | "exited";
  event: "minimize" | "restore" | "close-requested" | "keep-running-hidden" | "stop-and-exit" | "exit";
  dirtyProject: boolean;
  activeRunCount: number;
  activeTerminalCount: number;
};
```

Windows 默认将最小化解释为进入通知区域，不等于关闭或退出；已由用户启动且已授权的运行可按设置继续，但隐藏状态不能启动新任务。通知区域菜单至少提供显示 Blocky、暂停全部运行、打开运行日志和退出。

关闭请求在项目未保存、运行中或终端活动时进入 `close-confirmation`。用户可返回、保持隐藏运行，或停止并退出；每个选择都有独立命令和审计。第二实例把打开项目/聚焦请求交接给既有实例，不能启动第二套 Host 和端口。

真正退出先停止新请求，再结算并确认 Host、sidecar、preview、runtime、RPA、PTY、子进程/进程组、日志刷新器、管道、端口、文件句柄和文件锁全部归零。任何结算失败都保留在 `exiting` 或回到确认状态，禁止伪报 `exited`。

## 4. 稳定错误

| 代码 | 含义 |
|---|---|
| `BLK-SURFACE-001` | 未经明确页面意图出现 `app-surface.add` |
| `BLK-SURFACE-002` | Bridge 端点引用无效或申请越权能力 |
| `BLK-RPA-001` | v1alpha1 请求无人值守 RPA |
| `BLK-RPA-002` | 定位/恢复前外部状态复核失败 |
| `BLK-WINDOW-001` | 退出资源未全部结算 |

正反例见 `fixtures/valid` 与 `fixtures/invalid` 下对应 AppSurface、RPA 和窗口生命周期夹具。
