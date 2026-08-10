# Blocky 项目规则与项目地图

本文件只补充 Blocky 项目长期维护信息；跨项目通用规则以 `D:\AGENTS.md` 为准，不在这里重复。

## 1. 项目目标与当前阶段

Blocky 是面向普通用户与学校教育的安装式积木 AI（人工智能）创作软件。桌面端采用 Scratch（积木编程）式嵌套画布，不采用通用节点连线工作流；教育版与专业版共享项目格式、积木语言与运行内核。

当前仓库以产品设计、架构决策和可删除的 Windows Core（Windows 核心）技术尖峰为主，尚不是正式可发行产品：

- `try/windows-core-spike/` 已验证 ADR-001 第一阶段的本地 Blockly（积木编辑器）、稳定 IR（中间表示）、交互清单、一等 Tool（工具）、确定性运行时、窄 Tauri Host（宿主）和 Windows 原生测试通道。
- 技术结论为 GO（继续）：下一步可设计正式 monorepo（单体仓库）与共享包，但禁止把尖峰整体复制为产品。
- 完整 311 块、正式模型/插件适配器、账号/订阅、CLI（命令行）、安装签名、商店资源及后续平台仍需独立设计和验收。
- DeepSeek Flash 的 live（在线）结果只是用户授权的外部 API（应用程序接口）兼容性补充验证；普通产品构建不读取模型凭据，也没有内置 DeepSeek 适配器。

## 2. 核心文档入口

- 产品方向与当前状态：`README.md`
- 产品方案：`doc/产品设计/Blocky-初版产品方案.md`
- 完整积木与 Agent（智能体）兼容设计：`doc/产品设计/Blocky-完整积木与Agent兼容设计.md`
- 跨端技术选型：`doc/技术设计/ADR-001-首版跨端技术选型.md`
- Windows Core 技术结论：`doc/技术设计/Windows-Core技术尖峰报告.md`
- 长期模块验收：`doc/验收/模块/验收-Blocky编辑器与运行核心.md`
- 任务验收与历史证据：`doc/验收/归档/`
- 开发环境：`doc/开发/开发环境.md`
- 已完成计划：`doc/归档/`

产品目标、架构或模块职责变化时，优先更新上述对应文档；本文件只维护入口与不应分散的长期约束。

## 3. 目录职责

| 路径 | 职责 |
|---|---|
| `doc/产品设计/` | 产品范围、积木目录、交互、兼容模板和商业边界 |
| `doc/技术设计/` | ADR（架构决策记录）、技术报告与持久视觉证据 |
| `doc/验收/模块/` | 长期功能/场景基线 |
| 按需创建的 `doc/验收/跨模块/` | 只用于重要跨模块完整流程；当前目录尚未创建 |
| `doc/验收/归档/` | 已完成任务的 L0–L3（验收等级）记录 |
| `doc/进展记录/` | 按日期记录阶段进展、文件用途与异常 |
| `scripts/`、`tests/dev-environment/` | 跨平台开发环境 doctor（环境检查）及其稳定契约 |
| `try/windows-core-spike/src/blockly/` | 本地 Blockly 目录、连接语法、工具箱、夹具与画布适配 |
| `try/windows-core-spike/src/core/` | 纯 TypeScript（类型脚本）编译、IR、清单、Tool、运行事件与脱敏 |
| `try/windows-core-spike/src/app/`、`try/windows-core-spike/src/runtime/`、`try/windows-core-spike/src/builder/` | React（界面框架）三栏界面、控制器和运行/搭建视图 |
| `try/windows-core-spike/src/project/`、`try/windows-core-spike/src/host/` | 规范项目快照与窄 HostBridge（宿主桥） |
| `try/windows-core-spike/src-tauri/` | Rust（系统语言）原子项目存储、能力配置和 Windows 图标 |
| `try/windows-core-spike/tests/`、`try/windows-core-spike/scripts/` | 单元、组件、原生 E2E（端到端）、性能、长稳与安全门禁 |

## 4. 架构与数据流

唯一编辑事实是 Blockly workspace JSON（工作区对象表示）：

1. `compileWorkspace` 把工作区编译为版本化 `BlockyProgram`，并生成稳定 source map（来源映射）。
2. 同一编译投影生成 `InteractionManifest`（交互清单）和只读 `ToolContract`（工具契约）注册表；右侧运行界面只读取清单，不扫描画布猜能力。
3. `deterministicRuntime` 只读取 IR、source map、依赖注入的 model/tool seam（模型/工具接缝），并通过唯一工厂生成版本化、脱敏、冻结的 `RuntimeEvent`（运行事件）。
4. `SpikeProjectSnapshot` 保存 workspace、派生 IR 和清单；加载时重新编译并比较派生数据，不能信任磁盘中的派生字段。
5. `HostBridge` 的保存契约固定为 `{ projectId, json }`；生产实现 `TauriHostBridge` 只调用 `save_project` / `load_project`，Rust Host 不接受前端任意路径。
6. WDIO（WebdriverIO）钩子、插件与 capability（能力）只允许出现在专用测试构建；普通 release（发布构建）必须保持隔离。

## 5. 关键依赖与运行方式

尖峰依赖 Node.js（JavaScript 运行时）、pnpm（包管理器）、Rust/Cargo（构建工具）、Tauri（桌面壳）、React、TypeScript、Vite（构建器）、Blockly、Zod（数据校验）、Vitest（测试框架）和仅测试使用的 WebdriverIO。精确锁定版本以 `try/windows-core-spike/package.json`、`try/windows-core-spike/pnpm-lock.yaml`、`try/windows-core-spike/src-tauri/Cargo.toml` 与 `try/windows-core-spike/src-tauri/Cargo.lock` 为准。

常用命令从项目根执行：

```powershell
# 开发环境 26 项检查
pwsh -NoProfile -File .\scripts\check-dev-environment.ps1 -Json
pwsh -NoProfile -File .\tests\dev-environment\doctor-contract.ps1

# 安装尖峰锁定依赖
pnpm --dir .\try\windows-core-spike install --frozen-lockfile

# 快速、Core 和完整长稳门禁
pnpm --dir .\try\windows-core-spike check
pnpm --dir .\try\windows-core-spike check:core
pnpm --dir .\try\windows-core-spike check:full

# 普通 Web（网页资源）与 Tauri release 构建
pnpm --dir .\try\windows-core-spike build
pnpm --dir .\try\windows-core-spike tauri build --no-bundle
```

`check:full` 包含 360 个 5 秒循环与 30 次真实 Rust Host 保存/重载，耗时约 30 分钟以上；不得缩短后称为完整长稳通过。

## 6. 验收与复测矩阵

- Blockly 目录、连接、序列化或 100 块夹具变化：复测编辑、合法/非法连接、稳定 ID、保存/重开。
- IR、清单、Tool 或运行事件契约变化：运行单元/组件、`check:core`、原生 E2E 与三项性能；同步更新模块验收。
- Host、权限、CSP（内容安全策略）、日志或敏感扫描变化：按 L3 复测负例、真实原子保存、日志审计与普通包隔离。
- 事件上限、保存循环、WebView（网页视图）生命周期或长期状态变化：必须重新执行未缩短的 `check:full`。
- 只改文档：至少检查 UTF-8（统一字符编码）、相对链接、`git diff --check` 和仓库敏感扫描；引用测试事实时绑定产生事实的精确提交。
- 功能、预期或风险变化时，更新 `doc/验收/模块/`；每次交付在 `doc/验收/归档/` 留任务记录；出现重要完整跨模块流程时才创建并写入 `doc/验收/跨模块/`。

## 7. 项目特有安全与范围边界

- `logo/logo.png` 是当前批准的 Windows Logo（标识）母图；派生图标和持久截图的哈希记录在 Windows Core 技术报告。
- Blockly、脚本、样式和媒体必须随普通应用本地加载；普通构建不允许远程代码、WDIO 测试钩子或测试 capability。
- 项目 JSON、事件、前端日志和后端日志必须通过四目标敏感扫描；报告只写类别、目标与计数，不写匹配值。
- `try/windows-core-spike/` 是可删除尖峰，不是未来正式包边界。迁移复用逻辑时逐项建立正式包、版本、迁移与跨包测试。
- 当前私有 GitHub（代码托管）仓库为 `https://github.com/q2955161835-debug/Blocky-AI`。

## 8. 执行报告要求

交付报告应列出：精确提交、分支、修改范围、测试命令与退出码、原生 EXE（可执行文件）字节数/哈希、普通包隔离摘要、敏感扫描结果、未执行项、已知风险、工作区外写入和是否 push（推送）。不要把旧提交日志、历史长稳或忽略目录报告描述为当前提交的新运行。
