# Blocky

Blocky 是一款面向普通人和学校教育的“积木式 AI 创作软件”。用户通过可拼接、可解释的能力积木创建 AI 伙伴，并使用右侧搭建助手或运行入口完成创作、对话和调试。

![Blocky 已批准的 Windows Logo（标识）](logo/logo.png)

当前阶段已形成完整积木与主流 Agent 兼容设计基线，并在 `try/windows-core-spike/` 完成一个可删除的 Windows Core（Windows 核心）原生技术尖峰。该尖峰已通过 L3 验收，但不是正式 Blocky 应用，也不是可分发产品。

Windows Core 与未来移动使用端所需的本机开发工具链已准备，并提供可复现的[开发环境检查入口](doc/开发/开发环境.md)。Windows Core 技术结论为 GO（继续）：只授权下一步设计正式 monorepo（单体仓库）与共享包，不授权复制尖峰、发行、收费、上架或声称完整 311 块已实现。

## 已确认方向

- 产品形态：安装式客户端，无 Web 版。
- 版本：教育版与专业版共用同一项目格式、积木语言和运行内核。
- 开发顺序：先完成不受订阅限制的完整产品，再按已验收能力切分教育基础、教育拓展和专业权益。
- 平台：Windows 首发完整搭建与运行应用；macOS 后续提供同等桌面能力；Android、HarmonyOS、iOS 将来提供只使用已搭建 Agent 的应用。
- 核心差异：不是节点连线式工作流，而是像 Scratch 一样能嵌套、能约束错误、能逐步执行的视觉语言。
- 桌面布局：左侧积木库、中间 Scratch 式画布，右侧分为 Blocky 内置“搭建助手”和由聊天入口积木生成的“运行 Agent”两个标签页。
- 交互入口：没有聊天入口积木时运行标签页禁用；多个入口可切换和重命名，图片、文件、语音、Skills 与插件控件按入口能力积木解锁。
- 核心形态：工具是独立一等积木；Agent、交互入口、模型、Prompt、记忆、Skill、多 Agent 与护栏等重要语义具有专属外观，但复用统一连接规则。
- 用户术语：单个能力称为“能力积木”，扩展分发单元称为“积木包”，共享入口称为“积木社区”。
- 内置模板：完整产品提供 OpenClaw、Hermes、Pi、OpenCode 与 DeepSeek Harness 的原生兼容模板；Blocky 连接或托管锁定版本的官方运行时，并将原生配置、能力和执行状态可逆地映射为通用积木。
- Agent 接入：提供 `blocky` CLI、官方 Skills 包和 Codex 等客户端的官方插件，使编程 Agent 能创建积木、搭建 Agent、转换 GitHub 项目和逆向现有 Agent，并与图形页进行可审查协作。
- 品牌素材：`logo/logo.png` 是本次正式批准的 Windows Logo（标识）母图，Windows/Tauri 图标已生成并通过普通窗口检查；各平台上架资源、签名包图标矩阵和商店素材仍属于未来交付。

## 当前文档

- [产品方案总览](doc/产品设计/Blocky-初版产品方案.md)
- [完整积木与 Agent 兼容设计](doc/产品设计/Blocky-完整积木与Agent兼容设计.md)
- [积木完整清单](doc/产品设计/Blocky-积木完整清单.md)
- [交互入口与工具积木设计](doc/产品设计/Blocky-交互入口与工具积木设计.md)
- [OpenClaw、Hermes、Pi、OpenCode 与 DeepSeek Harness 官方兼容模板](doc/产品设计/内置兼容模板-OpenClaw-Hermes-Pi与OpenCode.md)
- [CLI 与官方 Agent Skill 产品设计](doc/产品设计/CLI与官方Agent-Skill.md)
- [平台分层与桌面技术选型](doc/技术设计/ADR-001-首版跨端技术选型.md)
- [Windows Core 技术尖峰报告](doc/技术设计/Windows-Core技术尖峰报告.md)
- [Windows Core L3 任务验收](doc/验收/归档/2026-08-10/验收-Windows-Core技术尖峰.md)
- [DeepSeek Flash Agent 补充验证](doc/验收/归档/2026-08-10/验收-DeepSeek-Flash-Agent补充验证.md)
- [Blocky 编辑器与运行核心模块验收](doc/验收/模块/验收-Blocky编辑器与运行核心.md)
- [项目规则与项目地图](AGENTS.md)
- [原生 Agent 兼容运行时](doc/技术设计/ADR-002-原生Agent兼容运行时.md)
- [CLI、官方 Agent Skills 与插件接口](doc/技术设计/ADR-003-CLI与官方Agent-Skill接口.md)
- [开放扩展与社区安全边界](doc/技术设计/ADR-004-开放扩展与社区安全边界.md)

## 当前结论

`try/` 中的 Windows Blockly/本地 WebView（网页视图）技术尖峰已在原始全量基线 `7eeb9a8e0974b4356e24abf80c3ade46d486af6e` 通过八项 Core、原生 E2E、性能、360-cycle/30 分钟长稳、安全与人工门禁；冻结契约补充提交 `642f06cb59420031925c47ee801505656e50ccf8` 重新通过聚焦、Fast、Core、原生 E2E、性能、日志审计与普通包隔离。下一步先设计正式仓库和共享包，再按独立子规格实现完整产品；ADR-001 第二阶段 Windows 完整能力和第三阶段后续平台仍未验证。完整产品通过后再切分订阅权益。
