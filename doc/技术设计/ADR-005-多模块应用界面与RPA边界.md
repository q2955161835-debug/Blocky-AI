# ADR-005：多模块项目、应用界面与 RPA 边界

| 项目 | 内容 |
|---|---|
| 状态 | 契约边界持续有效；多模块/窗口地基、页面生成与有人值守 RPA 分别在阶段 1–2、阶段 5、阶段 6–7 落地。阶段 5 与 6–7 的已验收范围见对应任务报告；无人值守 RPA 与部署仍属后续阶段 |
| 日期 | 2026-08-23 |
| 决策范围 | 多画布项目、跨模块链接、画布/浏览器标签、应用界面、RPA、非传统架构和 Windows 通知区域生命周期 |
| 关联文档 | [多画布、应用界面与 RPA 设计](../产品设计/Blocky-多画布应用界面与RPA设计.md)、[正式项目/IR 契约](正式契约/README.md)、[应用界面/RPA/窗口契约](正式契约/05-应用界面RPA与窗口-v1alpha1.md)、[完整开发计划](../执行计划/2026-08-23-Blocky-竞品驱动完整开发计划.md)、[ADR-001](ADR-001-首版跨端技术选型.md)、[ADR-003](ADR-003-CLI与官方Agent-Skill接口.md) |

## 1. 背景

单个 Blockly Workspace 足以验证编辑、编译和运行内核，却无法清晰承载多个 Agent、RPA、规则、状态机、服务模块和按需 Web 前端。把所有模块放进同一画布会降低可读性、增量编译和协作上限；把 Web 页面或 RPA 另做成平行产品模式，又会复制权限、版本、运行与可观察协议。

Windows 桌面产品还需要区分最小化、关闭、后台运行和真正退出。用户截图对应 Windows 通知区域隐藏图标面板，因此首发窗口生命周期必须有可恢复、可停止且无孤儿进程的明确契约。

## 2. 决策

### 2.1 项目事实源

正式 `.blocky` 项目由版本化 `ProjectManifest` 和多个模块 Workspace 组成：

```text
ProjectManifest
├── moduleIndex[] → <moduleId>/workspace.json
├── resourceReferences[]
├── appSurfaces[]                    # 可选，默认空
└── format / migration metadata
```

- 每个 Workspace JSON 是对应模块画布的唯一编辑事实。
- 模块编译产生 `ModuleIR`、source map 和诊断；跨模块链接器解析稳定 `moduleId`/`exportId`，生成 `ProjectIR`、InteractionManifest、ToolContract 和运行图。
- 打开的标签、顺序、视口、分栏和最近关闭列表属于用户会话状态，不进入作品运行语义。
- 旧单画布项目显式迁移为一个默认模块；显示名变化不改变引用，目标删除或接口改变必须产生可定位诊断。

### 2.2 项目标签与跨模块连接

中间区首批提供“画布”和“浏览器”两类项目标签。画布编辑 Agent、自动化或通用模块；浏览器只预览和调试用户明确创建的 `AppSurface`。关闭标签不能删除模块或页面产物。

跨画布连接使用有类型的模块引用、导出入口、事件、消息、委派和 ToolContract。Project Map 仅做导航、依赖摘要和影响分析，不可直接编辑运行拓扑或绕过 Blockly 语义。

### 2.3 应用界面必须显式创建

项目默认 `appSurfaces=[]`。只有用户主动提出创建操作页面、执行“创建应用界面”或导入已有前端并明确保留时，才能生成：

- `AppSurfaceManifest`；
- 锁定依赖的前端源码和可审查文件差异；
- `FrontendBridgeContract`；
- 可重新生成的构建/预览工件。

浏览器预览使用独立 origin 和存储分区。页面不能获得 Tauri 全局对象、任意 Host 命令、文件系统、Shell、安全存储或作品 Agent 的隐式工具权限，只能调用 Bridge 清单声明的入口。认证、数据库、域名、发布和远程部署是独立任务，不随页面创建发生。

### 2.4 RPA 使用共享语言和专用 Host 适配器

RPA 不新增封闭产品模式，而是由通用模块、工具、权限、运行事件和检查点表达。浏览器自动化优先使用语义定位；Windows 桌面自动化优先使用 UI Automation；图像/OCR 和绝对坐标依次作为回退，绝对坐标必须显示高风险警告。

RPA Host 契约按应用、窗口、目标、动作、数据范围和有效期授权。录制器只生成待审阅语义补丁，不记录密码、Token、验证码或隐私字段明文。副作用步骤声明幂等、重复执行和补偿策略；恢复前重新验证外部状态，禁止盲目重放。

阶段 7 只实现当前用户桌面上的有人值守流程。无人值守 Worker、机器池、队列、企业凭据、调度和审计留到阶段 11，并需单独 L3 架构、安全和运营验收。

### 2.5 非传统架构

编译器不把“Agent”作为唯一合法模块根。状态机、规则、行为树、事件驱动、传统工作流、RPA、数据处理和混合 AI 架构优先使用已有入口、状态、事件、工具、数据和控制流组合；只有现有类型、安全、可观察性或性能无法表达时才通过新 ADR 增加运行原语。

### 2.6 Windows 窗口生命周期

- 点击最小化默认隐藏主窗口到通知区域；用户可在设置中改为任务栏。
- 通知区域图标可恢复并聚焦主窗口；右键菜单提供打开、运行摘要、暂停全部、停止全部和退出。
- 最小化只改变可见性。只有用户已启动且允许后台继续的运行可在隐藏时继续。
- 有未保存内容或运行时，关闭按钮必须提供返回、停止并退出，以及满足条件时的保留后台运行并隐藏。
- 真正退出必须停止或结算 Host、sidecar、预览服务和托管运行时；图标消失后不得留下不可见孤儿进程。
- 使用受控窗口状态保存、单实例和多显示器可见区域恢复。

## 3. 取代和补充

本 ADR 把 ADR-001 与当前尖峰中的“单 Workspace 项目事实源”扩展为“Project Manifest + 每模块 Workspace”。它不改变 Blockly Workspace 作为单个画布编辑事实的结论，也不把浏览器预览解释为 Blocky Web 版。

## 4. 后果

### 正面

- 多 Agent 和复杂自动化可拆分、导航、增量编译和复用。
- Web 前端、RPA 和非传统架构复用同一类型、权限、轨迹与项目迁移体系。
- 页面创建保持显式，避免普通 Agent 项目无意增加依赖、部署和安全面。
- Windows 后台运行和真正退出具有可测试边界。

### 成本与风险

- 项目格式、编译器、撤销、保存、搜索和迁移从单 Workspace 升级为多模块事务。
- 浏览器隔离、前端依赖、预览服务回收和 Bridge 安全需要独立实现与长稳测试。
- Windows UI Automation、浏览器定位、图像回退和企业应用升级会产生定位器维护成本。
- 通知区域、单实例、多显示器和后台运行增加原生生命周期复杂度。

## 5. 阶段 0 必须冻结的契约

1. `ProjectManifest`、Module Descriptor、`ModuleIR`/`ProjectIR` 和单画布迁移 Schema。
2. `moduleId`/`exportId`、跨模块调用/事件类型和循环边界。
3. 项目数据、派生工件和用户标签会话状态的存储边界。
4. `AppSurfaceManifest`、`FrontendBridgeContract` 与预览隔离/回收协议。
5. RPA 应用会话、UI 目标、权限、轨迹、敏感输入和检查点协议。
6. `WindowLifecycle` 状态机、通知区域命令、单实例和真正退出结算协议。

## 6. 验收门槛

- 单画布项目可显式迁移，多画布保存重开无损；改名不破坏引用，删除/改接口产生可定位错误。
- 默认项目无 AppSurface；用户明确创建后才能出现前端文件和浏览器标签，拒绝差异后项目字节级不变。
- 跨项目浏览器 Cookie、LocalStorage、下载和调试能力隔离；页面不能取得未声明 Host 权限。
- RPA 语义/UIA 定位、坐标回退警告、权限、敏感输入、暂停/停止、检查点恢复和副作用负例通过。
- 最小化后可恢复，已允许的运行保持可观察；真正退出后通知区域图标、Host、sidecar、预览服务和托管运行时全部结算。
- 对应人工流程以[跨模块验收 U15–U18](../验收/跨模块/验收-Blocky核心创作与项目积木化流程.md)为准。

## 7. 官方依据

- Tauri 2 System Tray：<https://v2.tauri.app/learn/system-tray/>
- Tauri Window State：<https://v2.tauri.app/plugin/window-state/>
- Microsoft UI Automation：<https://learn.microsoft.com/en-us/dotnet/framework/ui-automation/ui-automation-overview>
- Microsoft Power Automate Desktop：<https://learn.microsoft.com/en-us/power-automate/desktop-flows/introduction>
- Playwright BrowserContext：<https://playwright.dev/docs/browser-contexts>

这些资料支持技术可行性和边界设计，不表示阶段 1–2 技术尖峰、RPA 安全或企业无人值守能力已通过。
