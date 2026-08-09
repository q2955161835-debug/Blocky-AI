# Blocky 内置兼容模板：OpenClaw 与 Hermes

| 项目 | 内容 |
|---|---|
| 版本 | v0.1 |
| 日期 | 2026-08-09 |
| 状态 | 产品与兼容性设计已确认，尚未实现 |
| 面向版本 | 先作为完整产品能力实现；已确认计划纳入教育拓展权益 |
| 目标平台 | Windows 完整运行与编辑；Android、HarmonyOS 远程编辑与控制 |

## 1. 产品定义

Blocky 内部提供 OpenClaw 和 Hermes 两个“原生兼容模板”。它们不是模仿原项目界面的示例作品，而是原版运行时的积木式控制面：用户通过 Blocky 的可拼接语言查看、配置、运行和调试官方原版 Agent。

一句话规则：

> 原版运行时负责真实行为，Blocky 积木负责可视化表达、约束、权限说明和执行观察。

这两个模板定位为完整产品的旗舰兼容能力，不纳入最初 Core 技术尖峰。产品先实现完整、可改造的模板，再在完整能力验收后切分权益；已确认的商业方向是纳入教育拓展版。

## 2. “百分百继承”的可验收定义

“完全百分百继承原项目”作为工程目标，必须同时满足以下六项；未全部通过时只显示实际兼容等级，不能宣传为完全兼容。

1. **运行时继承**：执行使用所选版本的官方 OpenClaw/Hermes 运行时，不用 Blocky 自研近似内核替代。
2. **配置继承**：原生配置可导入、编辑和导出；未图形化字段也原样保留。
3. **能力继承**：该版本公开的工具、技能、插件、渠道、模型、记忆、会话、自动化与多 Agent 能力均可发现并表示。
4. **行为继承**：相同输入、配置、权限和运行环境下，Blocky 启动的运行与原生入口遵循相同协议和状态变化。
5. **数据继承**：项目引用的原生技能、记忆、会话和资源保持其原生格式与目录语义；Blocky 不擅自改写内容。
6. **升级继承**：新增未知能力不会因 Blocky 未认识而丢失，并能在适配器升级后转换为专用积木。

上游自身缺陷、被上游移除的能力、第三方服务停用以及当前操作系统不支持的能力，不属于 Blocky 可承诺的等价范围，但必须在兼容报告中明确显示。

## 3. 用户入口与运行模式

### 新建入口

完整产品的“从模板创建”增加：

- `OpenClaw 原生兼容模板`
- `Hermes 原生兼容模板`

选择模板后先选择运行模式：

| 模式 | 适用场景 | Blocky 行为 |
|---|---|---|
| 连接已有运行时 | 用户已经安装或部署原项目 | 验证版本与能力清单后建立只读扫描，再由用户授权写入 |
| Windows 托管运行时 | 新用户希望一键使用 | 安装经过校验的固定上游版本，以独立进程运行并由 Blocky 管理启停 |
| 连接远程运行时 | Android、HarmonyOS 或多设备使用 | 手机只保存连接配置与积木项目，实际 Agent 在 Windows 或用户服务器运行 |

Blocky 不自动接管用户已有实例。第一次连接先展示将读取的配置位置、运行时版本、可见能力和写入范围；密钥只显示“已配置/未配置”，不进入画布或项目文件。

Codex 等通用 Agent 可以通过 `blocky compat` 命令和官方 `$build-blocky-agents` Skill 辅助完成只读扫描、积木化改造、差异预览和兼容报告；原生配置写回、安装扩展和真实运行仍遵守本文件的确认与兼容等级规则。

### 核心流程

```mermaid
flowchart LR
  A["选择 OpenClaw 或 Hermes"] --> B["连接或安装官方运行时"]
  B --> C["读取版本、配置与能力清单"]
  C --> D["生成可逆积木视图"]
  D --> E["校验权限与版本兼容性"]
  E --> F["由官方运行时执行"]
  F --> G["事件回传并高亮对应积木"]
  G --> H["保存 Blocky 项目或导出原生配置"]
```

## 4. 共用积木语言

两个模板共用 Blocky 的视觉语法，但积木正面保留原项目术语和来源标识，避免把不同概念错误合并。

| 积木组 | 用户看到的内容 | 兼容要求 |
|---|---|---|
| 运行时 | 项目类型、上游版本、连接方式、健康状态 | 固定版本并显示校验结果 |
| Agent | Agent 身份、指令、默认行为、子 Agent | 保留原项目的 Agent 层级和覆盖规则 |
| 模型 | Provider、模型、回退与推理参数 | 不把密钥写入积木 |
| 工具 | 工具或 Toolset、输入输出、权限 | 从运行时动态发现，不维护静态假清单 |
| 技能 | Skill、来源、启用条件、作用域 | 原生文件保持原样，Blocky 只保存引用和映射 |
| 记忆与会话 | 长期记忆、会话、上下文与压缩策略 | 保留原生存储语义，危险改写需确认 |
| 消息渠道 | 平台适配器、路由、白名单和配对 | 凭据使用系统安全存储引用 |
| 自动化 | Cron、触发器、后台任务和投递目标 | 显示常驻要求、下一次执行和副作用 |
| 扩展 | 插件、MCP、Hook、Provider 或节点能力 | 保留来源、版本、签名和权限信息 |
| 原生透传 | 尚未专门适配的字段、步骤或事件 | 可查看、可保存、可导回，默认不允许盲改 |

所有积木带有原生路径和来源映射。高级用户可以从积木跳转到“原生视图”检查对应字段；修改后的差异在写回前以可读方式确认。

## 5. OpenClaw 模板映射

OpenClaw 模板围绕长期运行的 Gateway 展开。Blocky 通过其 Gateway 协议和实时配置 Schema 发现能力，不把一份容易过时的字段表写死在编辑器里。

| OpenClaw 原生概念 | Blocky 积木表达 |
|---|---|
| Gateway | `运行 OpenClaw Gateway` 容器，显示地址、认证、健康和事件流 |
| Agents 与 defaults/entries | `定义 Agent`、`继承默认设置`、`覆盖 Agent 设置` |
| Models 与 fallback | `选择模型`、`如果不可用则改用` |
| Tools 与 tool policy | `允许工具`、`拒绝工具`、具体工具调用与确认积木 |
| Skills 与 ClawHub 来源 | `装载 Skill`、`限制 Agent 可用 Skill`、来源与安全提示 |
| Plugins、providers、hooks | `启用 OpenClaw 扩展` 容器及其原生配置子积木 |
| Channels | Telegram、Slack、Discord 等渠道与路由积木 |
| Sessions、memory | 会话策略、记忆检索和上下文积木 |
| Cron、heartbeat、hooks | 定时、心跳和生命周期事件积木 |
| Nodes 与设备能力 | 连接节点、声明设备能力、相机/屏幕/设备动作权限积木 |
| 多 Agent 与协调 | 委派、并行、等待和结果汇总积木 |

执行台订阅 Gateway 事件，把 Agent、聊天、工具、节点和定时事件定位到对应积木。无法映射的新事件仍以带原始类型和载荷摘要的“OpenClaw 原生事件”展示。

## 6. Hermes 模板映射

Hermes 模板围绕同一个 `AIAgent` 核心以及其 Gateway、TUI JSON-RPC、ACP 和 API Server 入口展开。Blocky 桌面端优先使用 TUI Gateway JSON-RPC，因为该入口覆盖会话、审批、澄清、多 Agent、分支和流式工具事件；HTTP API 作为远程与轻量兼容入口。

| Hermes 原生概念 | Blocky 积木表达 |
|---|---|
| AIAgent 与 Agent Loop | `运行 Hermes Agent` 容器、迭代与停止条件积木 |
| Provider、model 与热切换 | `选择模型`、`运行中切换模型` |
| Tools、Toolsets | 工具目录、参数、结果、进度和审批积木 |
| Terminal backends | Local、Docker、SSH 等后端选择与权限边界积木 |
| Skills 与自我改进 | `使用 Skill`、`创建/改进 Skill`，写入前显示差异并确认 |
| Memory 与 session search | 记忆、用户画像、会话检索、压缩和分支积木 |
| Gateway 与平台 adapters | 消息平台、授权白名单、DM 配对、路由和投递积木 |
| Cron 与后台运行 | 计划任务、投递目标、运行状态与停止积木 |
| Delegation 与 subagents | 委派、并行 Agent、引导、打断和结果汇总积木 |
| MCP、plugins、hooks | 扩展来源、配置、生命周期和权限积木 |
| ACP、API、batch | 外部控制入口和运行触发积木；默认收进高级目录 |

Hermes 的审批、澄清、sudo、secret 和会话改写事件必须在 Blocky 中保持原语义。尤其是截断/回退会话等破坏性写入，只有用户在当次操作中明确确认后才能发送，不能复用旧确认状态。

## 7. 项目保存与原生往返

兼容模板仍保存为 `.blocky` 项目，但增加 `compat/`：

```text
manifest.json
workspace.json
program.json
compat/
  origin.json              # openclaw 或 hermes、上游版本、来源、校验和
  mapping.json             # 原生字段/事件与积木 ID 的双向映射
  native/                  # 允许携带的原生配置快照与用户资源
  opaque.json              # 未识别但必须保留的字段
```

保存规则：

- 项目只保存凭据引用，不保存 API Key、Token、Cookie、私有密钥或消息平台密码。
- 导入默认只读扫描；用户确认后才写回原生目录。
- 导出原生配置时采用“读取当前原生文件 → 应用最小补丁 → 重新校验”的方式，避免整文件重写破坏注释、顺序和未知字段。
- 原生资源体积过大或含敏感内容时，项目只保存引用及内容指纹；跨设备打开时明确提示缺少资源。
- Blocky 删除积木不等于立即删除原生数据；先进入变更预览，危险删除需再次确认。

## 8. 版本、兼容等级与文案

每个模板首页显示上游名称、版本、提交、安装来源和兼容状态。版本由兼容矩阵明确列出，不默认跟随 `main`。

| 等级 | 含义 | 界面文案 |
|---|---|---|
| L0 来源识别 | 能确认项目类型与版本 | 已识别，未验证 |
| L1 可视化 | 能无损读取并生成积木 | 可查看 |
| L2 配置往返 | 导入、编辑、导出后通过原生校验 | 配置兼容 |
| L3 行为对照 | 核心运行、事件、审批和停止与原生入口一致 | 行为兼容 |
| L4 扩展覆盖 | 官方扩展面、未知字段和升级回退通过矩阵测试 | 已验证完全兼容 |

只允许对“模板版本 + 上游版本 + 平台 + 安装模式”的明确组合显示 L4。上游更新后先回到“待验证”，完成自动与人工兼容测试后再恢复，不使用永久性的“百分百兼容”徽章。

本次设计核验快照：OpenClaw `v2026.7.1-2`（tag commit `be8b8a9e8838f832e4fa47cde8bea0a33aec71ba`），Hermes `v2026.8.3`（tag commit `7de39e700d2c329e15d32eb0b96e2f7cdd9fbdb2`）。这些是 2026-08-09 的设计依据，不等于首个实现版本已经确定；编码时必须重新核验发布、安全公告和平台支持。

## 9. 权限、安全与法律边界

- 两个模板运行的是可调用终端、文件、网络、消息和扩展的真实 Agent，默认采用独立进程、最小权限和能力白名单。
- 第一次启用工具、渠道、后台任务或设备动作时，展示作用域、数据去向、持续时间和撤销方式。
- 最终教育权益切分不能默认继承宿主机高权限；终端、任意文件、消息发送和后台自动化仍按具体能力逐项授权。
- 社区可执行扩展按 [ADR-004](../技术设计/ADR-004-开放扩展与社区安全边界.md) 分型、签名、扫描和隔离；系统兼容适配器不能成为绕过社区安全流程或取得系统信任标识的安装通道。
- 第三方 Skill、Plugin、MCP 和脚本按不可信代码处理，安装前显示来源与权限，运行时尽可能隔离。
- OpenClaw 与 Hermes 当前均使用 MIT License。若 Blocky 分发其代码或二进制，安装包必须保留对应版权与许可证文本，并在第三方声明中标明来源；不得暗示获得官方背书。

## 10. 分期路线

1. **阶段 A：只读扫描**——Windows 连接已有实例，识别版本、配置和能力，生成只读积木视图。
2. **阶段 B：配置往返**——支持最小补丁写回、原生校验和未知字段保留。
3. **阶段 C：Windows 托管运行**——安装固定上游版本，完成启动、停止、流式事件、权限和错误映射。
4. **阶段 D：移动远程控制**——Android、HarmonyOS 编辑同一项目并安全连接 Windows/服务器运行时。
5. **阶段 E：完整兼容矩阵**——覆盖技能、插件、消息渠道、自动化、多 Agent、迁移和版本升级，达标组合标记 L4。

阶段 A 应在 Blocky 基础编辑器与 IR 尖峰通过后开始；两个上游适配器分开验收，不能因为其中一个完成而宣称另一模板兼容。

## 11. 验收门槛

- 官方原生配置导入后不修改即导出，语义内容与未知字段无损。
- 每个专用积木可追溯到原生字段、文件、工具或协议事件。
- 原生 CLI/Schema 校验通过，且相同测试用例分别从原生入口与 Blocky 运行得到一致的状态序列。
- 断线、版本不匹配、插件缺失、权限拒绝、运行时崩溃和上游升级均有可恢复提示。
- 扫描导出的 `.blocky`、日志和崩溃报告，不含真实密钥或私有令牌。
- Android、HarmonyOS 在运行端离线时仍可安全编辑；不会假装任务已经在手机本地执行。
- 分发包保留上游许可证、版本和内容校验和，并能回退到上一个已验证运行时版本。

## 12. 官方依据

- OpenClaw 官方仓库与 MIT License：<https://github.com/openclaw/openclaw>
- OpenClaw Gateway 架构：<https://docs.openclaw.ai/concepts/architecture>
- OpenClaw 配置与实时 Schema：<https://docs.openclaw.ai/gateway/configuration>
- OpenClaw 工具与 Skills：<https://docs.openclaw.ai/tools>、<https://docs.openclaw.ai/tools/skills>
- Hermes 官方仓库与 MIT License：<https://github.com/NousResearch/hermes-agent>
- Hermes 总体架构：<https://hermes-agent.nousresearch.com/docs/developer-guide/architecture>
- Hermes 程序化集成协议：<https://hermes-agent.nousresearch.com/docs/developer-guide/programmatic-integration>
- Hermes Gateway 内部架构：<https://hermes-agent.nousresearch.com/docs/developer-guide/gateway-internals>
- Hermes 工具体系：<https://hermes-agent.nousresearch.com/docs/user-guide/features/tools>
