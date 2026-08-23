# 阶段 1 Demo 正式接口交接

## 1. 交接目标

阶段 1 是首个正式 monorepo 代码纵切。它用锁定夹具完成可展示用户旅程，但项目格式、命令、事件、日志、设置和界面不增加阶段专用字段或旁路；后续真实服务直接替换确定性适配器，夹具永久保留为回归测试。

阶段 1 只消费本目录登记的 v1alpha1 契约：

```text
ProjectManifest + module Workspace JSON
  → compileWorkspace(ModuleIR + Diagnostic)
  → linkProject(ProjectIR)
  → projectInteraction(InteractionManifest + ToolContract)
  → deterministic adapters
  → RuntimeEvent
  → canvas highlight + run-log projection + trace navigation

Builder intent → BuildSpec → SemanticPatch → preview → accept/reject
Host → project/session/settings/task/window/log narrow ports
```

确定性适配器通过依赖注入注册到正式端口，不能把固定结果写进 `ToolContract` 或项目。拒绝补丁、关闭标签、隐藏面板和最小化窗口均不得越权改变项目或任务。

## 2. 用户旅程到接口矩阵

| 用户旅程 | 正式契约 | 正夹具 | 负夹具 | 阶段 1 最小实现 | 确定性适配器 | 阶段 2–9 替换阶段 | 人工验收 | 明确不在阶段 1 实现 |
|---|---|---|---|---|---|---|---|---|
| U01 从蓝图创建资料问答伙伴 | ProjectManifest、ResourceDefinition、InteractionManifest | `minimal-multi-module-project.json` | `missing-cross-module-export.json` | 从内置资料问答蓝图创建两模块项目并进入可运行画布 | 固定知识文档与回答脚本走 Tool/RuntimeEvent | 2 稳定项目/资源；3A/3B 真实资料与检索；4 真实模型 | 新用户从欢迎页完成创建并看到可运行入口 | 真实 Embedding、模型 API、云端知识库 |
| U02 修改角色、知识和回答方式并理解错误 | ModuleIR、Diagnostic、SettingDefinition | `minimal-multi-module-project.json` | `missing-cross-module-export.json` | 修改固定配置积木并即时编译，问题面板定位错误 | 固定 Schema 校验器 | 2 完整语言/设置；3B 检索配置；4 Agent 语义 | 修改三个字段、制造并修复一个链接错误 | 任意第三方 Provider 配置、完整上下文调优 |
| U03 运行、观察积木并定位问题 | RuntimeEvent、BlockExecutionVisualState、RunLogProjection | `deterministic-runtime-observability.json` | `secret-in-log-envelope.json` | 运行成功/警告/失败脚本；高亮、日志、轨迹入口同源 | 固定时钟、模型和工具脚本 | 4 真实运行；6 完整轨迹/诊断 | 核对绿/黄/红粗描边、图标文字和源积木跳转 | 断点、单步、回放、完整模型正文 |
| U04 多选保存并复用个人蓝图 | CommandDefinition、PointerGestureDefinition、SemanticPatch | `minimal-multi-module-project.json` | `missing-cross-module-export.json` | Shift 点击/框选后保存选择摘要为本机蓝图并重新插入 | 固定蓝图目录与确定性 ID 工厂 | 2 正式命令/存储；3D 蓝图 v1 | 多选、右键保存、空画布插入、一次撤销 | 云同步、社区发布、依赖自动安装 |
| U05 配置模型/知识资源且秘密不进项目 | ResourceDefinition、SettingDefinition、RedactionSummary | `minimal-multi-module-project.json` | `secret-in-log-envelope.json` | 绑定知识资源和虚构 secretRef；保存重开仍只见引用 | 固定资源注册表与不可用秘密存储适配器 | 2 正式设置/安全存储；3A/3B 知识；4 ModelProfile | 检查项目、Workspace、日志和导出均无秘密值 | 真实模型调用；需要时验收前主动向用户请求 API 配置 |
| U06 锁定 GitHub 快照生成候选积木/蓝图 | BuildSpec、SemanticPatch、ResourceDefinition | `minimal-multi-module-project.json` | `agent-attaches-user-terminal.json` | 读取仓库夹具摘要，生成可拒绝的候选积木/蓝图差异 | 固定仓库快照、许可证与依赖清单 | 3C 真实只读扫描/证据映射；9 发布官方转换 Skill | 审阅锁定提交、产物类型、权限差异，拒绝后项目不变 | 网络克隆、执行仓库代码、正式 CLI Skill 包 |
| U07 保存、关闭、重开并继续编辑 | ProjectManifest、WorkspaceSessionState、迁移契约 | `minimal-multi-module-project.json` | `missing-cross-module-export.json` | 原子保存项目事实、本地保存会话、重开重编译 | 内存或临时目录窄 Host 存储适配器 | 2 正式 Host、迁移和设置存储 | 保存、关闭、重开后模块/标签/选择目标一致 | 旧版本批量迁移、云同步、协作冲突 |
| U15 多画布、稳定引用与导航 | ProjectIR、ProjectLink、WorkspaceSessionState | `minimal-multi-module-project.json` | `missing-cross-module-export.json` | 打开两个画布标签、按稳定链接跳转、保存会话 | 固定链接器与模块 Workspace | 2 完整多模块语言和标签系统 | 重命名显示名后链接不变；缺失导出定位来源 | 大型项目增量编译、协作编辑 |
| U16 默认零页面与显式应用界面 | AppSurfaceManifest、FrontendBridgeContract、SemanticPatch | `explicit-app-surface.json` | `implicit-app-surface.json` | 新项目零页面；仅显式请求、预览并接受页面补丁后打开浏览器标签 | 锁定页面源与本地预览响应 | 2 浏览器/窗口地基；5 真实页面生成 | 普通 Agent 请求无页面；显式请求后从 0 变 1；拒绝不变 | 页面部署、任意 npm 包、跨项目浏览器存储 |
| U18 通知区域、后台运行和退出 | WindowLifecycle、TerminalSessionContract | `window-and-terminal-lifecycle.json` | `agent-attaches-user-terminal.json` | 最小化到通知区域、恢复、关闭保护和资源结算计数 | 固定长任务和可控进程句柄 | 2 完整窗口/终端/退出 Host | 隐藏时已授权任务继续；退出后计数全为零 | 开机自启、远程 Worker、无人值守任务 |
| U19 底部面板、用户终端、日志与诊断导出 | BottomPanelViewState、LogEnvelope、TaskDefinition、AuditRecord | `deterministic-runtime-observability.json`、`window-and-terminal-lifecycle.json` | `agent-attaches-user-terminal.json`、`secret-in-log-envelope.json` | 四视图面板壳；一个锁定任务；有界脱敏日志与诊断导出 | 固定任务输出、压力和脱敏样本 | 2 完整 PTY/日志总线/保留；6 完整轨迹；7 RPA 通道 | 问题定位、运行日志、终端截断、输出筛选、导出脱敏、退出结算 | 任意 Shell、Agent 操作用户终端、企业集中审计 |

## 3. 正反夹具目录

| 夹具 | 覆盖边界 | 阶段 1 消费者 |
|---|---|---|
| `valid/minimal-multi-module-project.json` | 两模块、知识资源、零页面、独立会话 | project-model、compiler、studio-desktop |
| `valid/deterministic-runtime-observability.json` | 确定事件、成功/警告/失败、高亮与日志 | runtime-core、runtime-observability、ui-editor |
| `valid/explicit-app-surface.json` | 显式页面补丁从 0 到 1 | builder-protocol、app-surface |
| `valid/attended-rpa.json` | UIA 优先、坐标高风险回退、敏感输入排除 | rpa-contract validator；阶段 1 不执行真实 RPA |
| `valid/window-and-terminal-lifecycle.json` | 通知区域、后台任务和退出归零 | studio-host、terminal-protocol |
| `invalid/missing-cross-module-export.json` | 缺失导出只报 `BLK-LINK-002` | linker、problems projection |
| `invalid/implicit-app-surface.json` | 普通 Agent 请求不能创建页面 | builder-protocol |
| `invalid/agent-attaches-user-terminal.json` | Agent 不能附加用户 PTY | terminal-protocol、host-capability |
| `invalid/unattended-rpa-v1alpha1.json` | v1alpha1 拒绝无人值守 | rpa-contract validator |
| `invalid/secret-in-log-envelope.json` | 未脱敏记录不进日志总线 | observability redactor |

所有夹具的 `caseId` 唯一，`expect.valid` 和 `diagnosticCodes` 可机器读取。正夹具必须无预期错误；负夹具只列根因代码，避免把级联噪声写成稳定行为。

## 4. 替换账本

| 阶段 | 替换范围 | 保持不变 |
|---|---|---|
| 阶段 2 | 替换阶段 1 的项目/设置/命令/终端/日志/窗口窄实现；加入显式迁移 | v1alpha1 消费端口、十个夹具、用户旅程断言 |
| 阶段 3A | 固定资料来源替换为文件、URL、仓库真实摄取 | ResourceDefinition、来源 ID、脱敏边界 |
| 阶段 3B | 固定关键词结果替换为关键词、向量/混合检索、过滤、重排和引用 | ToolContract、RuntimeEvent、知识资源引用 |
| 阶段 3C | 固定仓库建议替换为只读扫描、提交/许可证/依赖锁定和证据映射 | BuildSpec、SemanticPatch、拒绝不写项目 |
| 阶段 4 | 固定模型响应替换为真实 ModelProfile 和最小 Agent 语义 | InteractionManifest、事件和资源秘密引用 |
| 阶段 5 | 锁定页面源替换为用户显式触发、可审查的应用界面生成 | 默认零 AppSurface、Bridge 最小权限 |
| 阶段 6 | 最小轨迹入口替换为完整轨迹、断点、单步、回放和诊断包 | RuntimeEvent 为高亮/日志/轨迹同源事实 |
| 阶段 7 | RPA 只校验夹具替换为真实有人值守执行和专业编辑交互 | `mode: attended`、定位优先级、检查点和隐私边界 |
| 阶段 9 | 发布真实 CLI Core、四个 Blocky 官方 Skills 和 Codex 插件 | 共用项目/补丁/任务/资源契约，不复制领域逻辑 |

夹具实现被真实服务替换后删除对应适配器，但保留 JSON 作为回归输入；产品中没有需要迁移或删除的阶段专用字段。

## 5. 阶段 1 实施门禁

1. 正式包只依赖注册 Schema，不能从 `try/windows-core-spike/` 整体复制目录。
2. 每个夹具通过与生产相同的解析、编译、链接、权限、事件和日志端口注入。
3. 所有写入经 Project Model/Host 原子接口；拒绝或失败后项目摘要与字节不变。
4. 用户终端和 Agent 任务使用不同协议、句柄空间和能力校验。
5. 页面默认不创建，RPA 不执行真实桌面副作用，真实模型 API 不在阶段 1 默认验收中使用。
6. 人工按 U01–U07、U15、U16、U18、U19 顺序走通；自动化保留十个夹具的正反断言。
