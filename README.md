# Blocky

Blocky 是一款面向普通人和学校教育的“积木式 AI 创作软件”。用户通过可拼接、可解释的能力积木创建 AI 伙伴，并使用右侧搭建助手或运行入口完成创作、对话和调试。

![Blocky 已批准的 Windows Logo（标识）](logo/logo.png)

当前阶段已形成完整积木与主流 Agent 兼容设计基线，并在 `try/windows-core-spike/` 完成一个可删除的 Windows Core（Windows 核心）原生技术尖峰。该尖峰已通过 L3 验收，但不是正式 Blocky 应用，也不是可分发产品。

Windows Core 与未来移动使用端所需的本机开发工具链已准备，并提供可复现的[开发环境检查入口](doc/开发/开发环境.md)。Windows Core 技术结论为 GO（继续）；阶段 1 正式 monorepo 与共享包已按确认范围建立并完成独立验收。尖峰不作为正式产品代码入口；完整积木目录和后续发行能力仍未完成。

## 当前开发入口（2026-09-17）

正式 monorepo 已建立，阶段 1 已按用户确认范围通过 S1-01–S1-12。最终普通候选来源为 `1e106a2`，发行目录为 `dist/Blocky-Studio-0.1.0-ui-fix/`，已完成独立 GUI、组件、CLI、Host、发行扫描和包装复验；详见[阶段 1 正式验收报告](doc/验收/任务/验收-2026-09-16-Blocky阶段1正式Demo.md)及[验收证据清单](doc/验收/任务/阶段1证据/)。Windows 工具链检查26/26。

最新测试/诊断源码 `970d815` 的 `pnpm check:core` 与 Full 组成命令均退出 0；Full 完成 360/360 个五秒循环、30/30 次真实 Host 保存重开，耗时 1,803,544 ms，堆增长 6,660,204 字节。前两次中止和首次 `undo failed` 原因不明的残余波动风险仍按正式报告保留；根 `pnpm check:full` 别名未另行重复执行。真实大模型 API 调用为“否”，远端 CI 未执行。后续阶段能力仍未实现。

用户要求 CLI 与领域同步开发，优先通过 CLI 验证。CLI 支持目录、个人蓝图、项目创建/配置/检查/编译/运行、锁定仓库候选、页面补丁、注册任务及诊断导出，共用桌面领域和 Rust 存储；用法见 [CLI 说明](tools/blocky-cli/README.md)。真实大模型 API 调用：否；未真实调用外部大模型 API。

```powershell
pnpm install --frozen-lockfile
pnpm check
pnpm test:component
pnpm test:host
pnpm build:cli
pnpm test:cli
.\blocky.cmd --help
# Windows 桌面开发/普通构建
pnpm dev
pnpm build
```

原生自动化包：`pnpm test:e2e:build` 后运行 `pnpm test:e2e`。`pnpm check:core` 与 `pwsh -NoProfile -File scripts/check-native-core.ps1 full` 已按组成命令分别执行并通过；`pnpm check:full` 是顺序别名，未另行重复执行。完整 Full 含 360 个五秒循环及 30 次不同内容的 Rust 保存重开。端口检查可单独执行 `scripts/check-native-core.ps1 core|full`，不能替代普通窗口验收或冒充聚合命令单独通过。

普通开发包从默认 `apps/studio-host/target/release/blocky-studio.exe` 输出；发行隔离构建在 `try/release-native-target/release/`，测试包在 `try/native-e2e-target/release/`。Windows iframe 隔离使用锁定 Wry 修复，来源和维护责任见 [补丁说明](vendor/WRY-PATCH.md)。

可交付候选使用 `pnpm build:release` 统一重映射 Rust 构建路径，输出 `try/release-native-target/release/blocky-studio.exe` 及 `tools/blocky-cli/dist/`，随后运行 `pnpm check:release`。常规开发构建可能含本机构建路径，不能直接代替此候选；构建时扫描报告写入 `try/stage1-release/artifacts.json`；本次交付的固定证据见[发行扫描记录](doc/验收/任务/阶段1证据/release-artifacts-menu-contrast-final.json)，报告不进入产品目录。

通过候选扫描后，`pnpm package:release` 生成 `dist/Blocky-Studio-0.1.0/`，包含桌面程序、CLI、使用说明、第三方许可证和 selectors 对应源码；目标已存在时拒绝覆盖。许可证从锁定依赖及 `vendor/licenses/registry.json` 校验收集，缺失即停止构建。此命令不安装、启动或发布应用，也不代表普通窗口验收通过。

最终普通候选位于 `dist/Blocky-Studio-0.1.0-ui-fix/`，来源为 `1e106a2`，已完成 GUI 与组件局部复验。22 项、共 10,666,833,465 字节的构建缓存按 [storage-moves-final.json](doc/验收/任务/阶段1证据/storage-moves-final.json) 记录整理，9 月 16 日的旧映射仅作历史证据。重新执行隔离扫描前，应先运行 `pnpm test:e2e:build` 和 `pnpm build:release` 产生测试正控制与普通包；生成测试包不等于运行界面验收。

CLI 增补计划见[已归档同步开发补充](doc/归档/2026-09-17/2026-09-16-CLI同步开发补充.md)。团队项目；main 合并、任务分支删除和 push 仍须用户单独决定。

## 已确认方向

- 产品形态：安装式客户端，无 Web 版。
- 版本：教育版与专业版共用同一项目格式、积木语言和运行内核。
- 开发顺序：先完成不受订阅限制的完整产品，再按已验收能力切分教育基础、教育拓展和专业权益。
- 平台：Windows 首发完整搭建与运行应用；macOS 后续提供同等桌面能力；Android、HarmonyOS、iOS 将来提供只使用已搭建 Agent 的应用。
- 核心差异：不是节点连线式工作流，而是像 Scratch 一样能嵌套、能约束错误、能逐步执行的视觉语言。
- 桌面布局：左侧积木库，中间是带“画布/浏览器”项目标签的 Scratch 式工作区，右侧分为 Blocky 内置“搭建助手”和由聊天入口积木生成的“运行 Agent”两个标签页。
- 多模块项目：一个项目可打开多个 Agent、自动化或通用模块画布；跨画布通过稳定、类型化的引用和事件连接，不要求全部 Agent 位于同一画布。
- 应用界面：默认不创建 Web 前端；只有用户主动要求后，才生成可审查页面差异并在隔离浏览器标签预览，部署、域名、认证和数据库仍是独立任务。
- 自动化上限：RPA 可独立运行或作为 Agent 工具；状态机、规则、行为树、事件驱动、传统工作流和混合 AI 架构可使用同一模块语言自由组合。
- Windows 生命周期：点击最小化默认进入通知区域；最小化、关闭、退出和后台运行分别处理，真正退出后不得遗留 Host、预览服务或运行时孤儿进程。
- 交互入口：没有聊天入口积木时运行标签页禁用；多个入口可切换和重命名，图片、文件、语音、Skills 与插件控件按入口能力积木解锁。
- 核心形态：工具是独立一等积木；Agent、交互入口、模型、Prompt、记忆、Skill、多 Agent 与护栏等重要语义具有专属外观，但复用统一连接规则。
- 用户术语：单个能力称为“能力积木”，扩展分发单元称为“积木包”，共享入口称为“积木社区”。
- 内置模板：完整产品首批提供 Pi、Codex、OpenClaw、Hermes、OpenCode 与 DeepSeek Harness 六个原生兼容模板；Blocky 连接或托管锁定版本的官方运行时，并将原生配置、能力和执行状态可逆地映射为通用积木。
- Agent 接入：提供 `blocky` CLI、官方 Skills 包和 Codex 等客户端的官方插件，使编程 Agent 能创建积木、搭建 Agent、转换 GitHub 项目和逆向现有 Agent，并与图形页进行可审查协作。
- 项目积木化：`$convert-github-project-to-blocky` 是官方 Skills 库的核心入口，按锁定源码证据生成自定义积木、可展开蓝图、兼容模板草案或原生保留报告；首个真实组件纵切是知识库/RAG，不为第三方框架复制品牌积木。
- 首个代码阶段：优先交付可展示 Demo，并让固定知识/GitHub 夹具走正式接口；Demo 不在界面、项目格式、设置或运行事件中增加以后需要删除的专用标记或分支。
- 品牌素材：`logo/logo.png` 是本次正式批准的 Windows Logo（标识）母图，Windows/Tauri 图标已生成并通过普通窗口检查；各平台上架资源、签名包图标矩阵和商店素材仍属于未来交付。

## 当前文档

- [竞品驱动完整开发计划](doc/执行计划/2026-08-23-Blocky-竞品驱动完整开发计划.md)
- [阶段 0 正式契约索引](doc/技术设计/正式契约/README.md)
- [阶段 1 Demo 正式接口交接](doc/技术设计/正式契约/07-阶段1-Demo接口交接.md)
- [阶段 1 正式 Demo 实施计划（已归档）](doc/归档/2026-09-17/2026-09-16-Blocky-阶段1正式Demo实施计划.md)
- [阶段 1 任务验收](doc/验收/任务/验收-2026-09-16-Blocky阶段1正式Demo.md)
- [阶段 0 已完成实施计划](doc/归档/2026-08-23/2026-08-23-Blocky-阶段0契约冻结实施计划.md)
- [阶段 0 验收记录](doc/验收/归档/2026-08-23/验收-Blocky阶段0契约冻结.md)
- [状态与阶段替换账本](doc/产品设计/Blocky-状态与阶段替换账本.md)
- [GitHub 项目积木化与 Agent 组件设计](doc/产品设计/Blocky-GitHub项目积木化与Agent组件设计.md)
- [多画布、应用界面与 RPA 设计](doc/产品设计/Blocky-多画布应用界面与RPA设计.md)
- [设置中心设计模板](doc/产品设计/Blocky-设置中心设计模板.md)
- [产品方案总览](doc/产品设计/Blocky-初版产品方案.md)
- [完整积木与 Agent 兼容设计](doc/产品设计/Blocky-完整积木与Agent兼容设计.md)
- [积木完整清单](doc/产品设计/Blocky-积木完整清单.md)
- [交互入口与工具积木设计](doc/产品设计/Blocky-交互入口与工具积木设计.md)
- [Pi、Codex、OpenClaw、Hermes、OpenCode 与 DeepSeek Harness 内置兼容模板](doc/产品设计/Blocky-内置兼容模板.md)
- [CLI 与官方 Agent Skill 产品设计](doc/产品设计/CLI与官方Agent-Skill.md)
- [平台分层与桌面技术选型](doc/技术设计/ADR-001-首版跨端技术选型.md)
- [Windows Core 技术尖峰报告](doc/技术设计/Windows-Core技术尖峰报告.md)
- [Windows Core L3 任务验收](doc/验收/归档/2026-08-10/验收-Windows-Core技术尖峰.md)
- [DeepSeek Flash Agent 补充验证](doc/验收/归档/2026-08-10/验收-DeepSeek-Flash-Agent补充验证.md)
- [Blocky 编辑器与运行核心模块验收](doc/验收/模块/验收-Blocky编辑器与运行核心.md)
- [Blocky 核心创作与项目积木化跨模块验收](doc/验收/跨模块/验收-Blocky核心创作与项目积木化流程.md)
- [项目规则与项目地图](AGENTS.md)
- [原生 Agent 兼容运行时](doc/技术设计/ADR-002-原生Agent兼容运行时.md)
- [CLI、官方 Agent Skills 与插件接口](doc/技术设计/ADR-003-CLI与官方Agent-Skill接口.md)
- [开放扩展与社区安全边界](doc/技术设计/ADR-004-开放扩展与社区安全边界.md)
- [多模块项目、应用界面与 RPA 边界](doc/技术设计/ADR-005-多模块应用界面与RPA边界.md)
- [底部面板、终端与日志系统边界](doc/技术设计/ADR-006-底部面板终端与日志系统边界.md)

## 当前结论

`try/` 中的 Windows Blockly/本地 WebView（网页视图）技术尖峰已完成独立技术验收，作为可删除的历史证据保留，不是正式产品入口。阶段 0 契约已通过并归档；阶段 1 正式 monorepo、同步 CLI、桌面候选和配套证据已按用户确认范围通过 S1-01–S1-12，正式入口见[阶段 1 任务验收](doc/验收/任务/验收-2026-09-16-Blocky阶段1正式Demo.md)与[验收证据清单](doc/验收/任务/阶段1证据/)。阶段 2 起再按替换账本逐项实现真实多模块语言、知识/RAG、项目积木化、模型、轨迹、应用界面、RPA 和官方 Skills；这些后续能力及 ADR-001 第二阶段 Windows 完整能力、第三阶段后续平台仍未实现或验证。完整产品通过后再切分订阅权益。
