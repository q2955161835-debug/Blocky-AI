# Blocky CLI 与官方 Agent Skill 产品设计

| 项目 | 内容 |
|---|---|
| 版本 | v0.4 |
| 日期 | 2026-08-23 |
| 状态 | 产品与命令面设计已确认；2026-09-16 起按用户要求同步实现 CLI 的已完成领域入口，完整命令面/Skills/插件未完成 |
| 命令名 | `blocky` |
| 官方 Skills 入口 | `$build-blocky-agents`、`$create-blocky-blocks`、`$convert-github-project-to-blocky`、`$reverse-agent-to-blocky` |
| 首发环境 | Windows；从任意本地项目目录调用 |

> 更新说明（2026-08-23）：官方集成已从单一 `$build-blocky-agents` Skill 扩展为四个 Skills 与 Codex 等客户端的官方插件；`$convert-github-project-to-blocky` 固定为核心项目积木化入口，可输出自定义积木、可展开蓝图、兼容模板草案或原生保留报告。具体证据链、RAG 积木和 Harness 夹具见[《Blocky GitHub 项目积木化与 Agent 组件设计》](Blocky-GitHub项目积木化与Agent组件设计.md)。

当前已实现命令以 [`tools/blocky-cli/README.md`](../../tools/blocky-cli/README.md) 与 `blocky --help` 为准；本文后续命令表为完整目标，未进入帮助列表的命令不得宣称可用。

## 1. 产品目标

Blocky 除图形编辑器外，提供内置搭建助手、稳定 CLI、官方 Agent Skills 包和客户端插件，使用户既可直接在应用内获得积木帮助，也可让 Codex 等外部 Agent 与同一画布协作。本文详细定义这些入口共用的机器契约。

各层分工明确：

- `blocky` CLI 是机器接口，负责确定性读取、创建、编译、校验、差异、模拟、运行和兼容适配。
- Blocky 内置搭建助手使用受限的画布查询、语义补丁、校验和模拟工具；默认审阅修改，也可在逐轮检查点保护下直接搭建。
- 官方 Skills 是工作方法，告诉通用 Agent 何时调用哪些命令、如何控制上下文，以及哪些操作必须先展示差异或取得授权。
- 官方插件负责发现 Skills、CLI 和本机图形页，不复制语言或运行时。
- Blocky 桌面应用仍是积木画布、权限确认和可视化调试的主要入口。

内置助手、CLI、Skills 与插件不提供第二套 Agent 语言，也不允许绕过 Blocky 的类型、安全和兼容性规则。

## 2. 典型用户任务

用户可以直接对通用 Agent 说：

```text
用 Blocky 帮我搭一个收到投诉后分类、生成回复草稿并让我确认的 Agent。
```

```text
把这个 Blocky 作品改成同时保留摘要和原文，先给我看差异，不要运行。
```

```text
把我现有的 OpenClaw 配置读成积木，解释每一组权限，但不要写回。
```

```text
检查这个 Hermes 模板为什么无法通过兼容验证，并生成一份修复计划。
```

```text
分析这个锁定 commit 的 RAG 项目，优先复用 Blocky 知识积木；适合封装的做成自定义积木，完整流程保存为可展开蓝图，先给我看证据和差异。
```

```text
把资料问答 Agent 和工单 RPA 分到两个画布，建立类型化调用；再为 Agent 创建一个操作页面，只预览，不部署。
```

通用 Agent 负责理解自然语言和编辑声明式 Build Spec；CLI 负责把结果转换为真实 Blocky 项目并给出可验证结果。

## 3. 支持范围

### 第一阶段：本地安全闭环

- 检查 CLI、Blocky 核心和项目格式版本。
- 查询可用能力积木、模板、类型、权益和权限说明。
- 从 Build Spec 创建 `.blocky` 项目。
- 将现有 `.blocky` 导出为可读、可修改的 Build Spec。
- 校验、解释错误、比较差异和生成修复建议所需的结构化信息。
- 使用模拟模型进行确定性试运行并输出积木级事件。
- 安装、验证和定位官方 Skill。

### 后续阶段

- 连接真实模型和 Blocky 本地运行 Host。
- Pi、Codex、OpenClaw、Hermes、OpenCode、DeepSeek Harness 只读扫描、原生往返和兼容报告。
- 经 Blocky UI 授权的真实运行、外部行动和远程实例控制。
- macOS CLI；Windows 以外平台的发行包在对应桌面端适配时加入。

Android、HarmonyOS 与 iOS 不提供设备本地 CLI 或积木编辑器。它们接收桌面端发布的 Agent，并根据能力协商选择轻量本地运行或连接 Windows、macOS、用户服务器；CLI 只随 Windows 和后续 macOS 完整应用发行。

## 4. 命令设计

### 环境和发现

| 命令 | 作用 | 默认副作用 |
|---|---|---|
| `blocky --version` | 显示 CLI、Core、项目 Schema 和 Skill 版本 | 无 |
| `blocky doctor --json` | 检查安装、Core、Host、路径、版本和可用运行时 | 无 |
| `blocky schema show <name> --json` | 输出 Build Spec、CLI 响应或事件 Schema | 无 |
| `blocky catalog list --json` | 分页列出当前版本和权益可见的能力积木 | 无 |
| `blocky catalog show <block-id> --json` | 精确读取积木输入、输出、权限和示例 | 无 |
| `blocky template list --json` | 列出内置模板及运行时要求 | 无 |
| `blocky template show <template-id> --json` | 读取一个模板的结构和兼容信息 | 无 |

### 项目创建和修改

| 命令 | 作用 | 关键约束 |
|---|---|---|
| `blocky project create --from <spec> --output <file>` | 从 Build Spec 创建新项目 | 目标存在时拒绝覆盖 |
| `blocky project inspect <file> --json` | 返回项目摘要、权限、版本和问题 | 不展开大资源或密钥 |
| `blocky project export-spec <file> --output <spec>` | 导出可供 Agent 修改的 Build Spec | 保留稳定 ID 与未知内容 |
| `blocky project diff <file> --spec <spec> --json` | 预览应用 Spec 后的积木、权限和语义差异 | 永远只读 |
| `blocky project apply <file> --spec <spec>` | 将已预览的 Spec 应用到项目 | 必须携带最新差异指纹；冲突时停止 |
| `blocky project validate <file> --profile <mode> --json` | 校验结构、类型、权益、权限和迁移 | 不自动修复 |

`project apply` 不接受“忽略全部错误”开关。Agent 需要重新读取错误、修改 Spec 并再次验证。

### 多模块与应用界面

| 命令 | 作用 | 关键约束 |
|---|---|---|
| `blocky project module list <file> --json` | 列出模块、入口、导出和诊断 | 不读取标签会话状态 |
| `blocky project module inspect <file> --module <id> --json` | 读取单模块摘要和跨模块依赖 | 大 Workspace 写工件，不直接塞入 stdout |
| `blocky surface list <file> --json` | 列出显式创建的 AppSurface | 新项目默认返回空列表 |
| `blocky surface plan <file> --module <id> --goal <text> --json` | 规划页面、Bridge、依赖和文件产物 | 不修改项目、不安装依赖、不启动预览 |
| `blocky surface diff <plan> --target <file> --json` | 生成可审查前端和 Manifest 差异 | 返回项目/计划/文件差异指纹 |
| `blocky surface apply <plan> --target <file> --diff-digest <digest>` | 应用已审阅页面差异 | 冲突停止；不自动部署、开域名或建数据库 |
| `blocky surface build <file> --surface <id> --json` | 在锁定依赖和资源预算下构建 | 需要受控构建 Host |
| `blocky surface preview <file> --surface <id> --json` | 请求桌面应用打开隔离浏览器预览 | 需要 Host；不返回可复用权限令牌 |

只有 `surface plan` 或等价的用户显式 UI 命令可以开始应用界面创建。Agent 搭建完成、运行或发布 API 不得隐式调用这些命令。

### RPA 检查与导入

| 命令 | 作用 | 关键约束 |
|---|---|---|
| `blocky rpa inspect <file> --module <id> --json` | 列出目标应用、定位器、权限、副作用和恢复点 | 只读，不连接或操作应用 |
| `blocky rpa validate <file> --module <id> --profile attended --json` | 校验有人值守自动化结构 | 阶段 7 首批只支持 attended |
| `blocky rpa import-recording <recording> --target <file> --module <id> --json` | 将用户主动录制结果转换为幽灵积木 | 密码/Token/验证码不进入录制工件；默认只生成差异 |

实际连接、查找、操作、截图、暂停和恢复由桌面 Host 与运行协议执行；CLI 不提供绕过 UI 授权的“全局控制电脑”快捷命令。无人值守 Worker 命令在阶段 11 专项设计前不进入 CLI。

### GitHub 项目积木化

| 命令 | 作用 | 关键约束 |
|---|---|---|
| `blocky convert snapshot --repo <url> --ref <ref> --output <dir> --json` | 获取锁定、可重放的仓库快照 | 网络与缓存写入单独显示；不执行仓库代码或安装脚本 |
| `blocky convert inspect <snapshot-or-local-path> --json` | 读取语言、入口、依赖、类型、数据流、副作用和许可证摘要 | 只读；大证据写工件 |
| `blocky convert plan <snapshot> --goal <text> --json` | 生成源码证据映射与产物选择 | 只建议自定义积木、蓝图、兼容草案或保留项，不修改项目 |
| `blocky convert benchmark <plan> --profile <tier> --json` | 执行确定性契约与性能基线 | 只运行 Blocky 白名单夹具，不运行上游任意脚本 |
| `blocky convert diff <plan> --target <file> --json` | 生成 Build Spec 和幽灵语义差异 | 只读，返回差异指纹 |
| `blocky convert apply <plan> --target <file> --diff-digest <digest>` | 应用已审阅转换产物 | 不覆盖并发修改；阻塞/未知项保持可见 |

阶段 1 Demo 只使用仓库内锁定的本地快照，通过相同 `inspect/plan/diff` 领域接口完成端到端流程；界面、项目和 Schema 不增加 Demo 专用标记。真实网络快照与正式命令在转换领域服务、供应链门禁和 CLI Core 稳定后开放。

### 运行和观察

| 命令 | 作用 | 关键约束 |
|---|---|---|
| `blocky run plan <file> --json` | 列出将使用的模型、数据、权限、预算和副作用 | 不执行 |
| `blocky run start <file> --simulate --jsonl` | 使用确定性模拟模型运行 | 第一阶段唯一可无额外授权运行的模式 |
| `blocky run start <file> --live --approval-ref <ref> --jsonl` | 真实运行 | 后续实现；授权引用由 Blocky UI 创建 |
| `blocky run watch <run-id> --jsonl` | 订阅积木级事件 | 支持断点续传序号 |
| `blocky run stop <run-id> --json` | 请求停止运行 | 仅作用于指定运行 ID |

### 原生 Agent 兼容

| 命令 | 作用 | 默认行为 |
|---|---|---|
| `blocky compat detect --runtime <name> --json` | 检测上游实例、版本和连接模式 | 只读 |
| `blocky compat inspect --runtime <name> --json` | 读取能力、配置摘要和兼容等级 | 只读、脱敏 |
| `blocky compat import --runtime <name> --output <file>` | 将原生实例投影为 Blocky 项目 | 默认不写原生目录 |
| `blocky compat diff <file> --runtime <name> --json` | 比较积木项目与原生状态 | 只读 |
| `blocky compat export <file> --runtime <name> --dry-run --json` | 生成原生写回计划 | 默认只能 dry-run |
| `blocky compat report <file> --json` | 输出版本组合和 L0-L4 证据 | 不提升兼容等级 |

`<name>` 首批支持 `pi`、`codex`、`openclaw`、`hermes`、`opencode` 和 `deepseek-harness`（可接受别名 `dsh`，结构化输出统一返回规范名）。原生写回后续只通过带 Blocky 作用域授权的命令开放；CLI 不提供直接修改任何上游数据目录的快捷命令。Claude Code 先作为公开配置/扩展/行为夹具，未通过专项决策前不加入首批模板枚举。

### 官方 Skill 管理

| 命令 | 作用 | 默认行为 |
|---|---|---|
| `blocky agent skill path --json` | 返回应用内置官方 Skill 的路径和版本 | 只读 |
| `blocky agent skill verify --json` | 校验 Skill 内容、来源、版本与哈希 | 只读 |
| `blocky agent skill install --client <id> --scope <scope> --dry-run --json` | 展示目标位置和文件变更 | 默认只预览 |
| `blocky agent skill install --client <id> --scope <scope> --apply --json` | 安装或升级 Skill | 仅写明确的 Skill 目录 |
| `blocky agent skill uninstall --client <id> --scope <scope> --dry-run --json` | 展示将删除的官方文件 | 默认只预览 |
| `blocky agent skill uninstall --client <id> --scope <scope> --apply --json` | 删除由 Blocky 管理且哈希匹配的 Skill | 用户改过的文件拒绝删除 |
| `blocky agent skill export --output <dir> --json` | 为未知但兼容标准的客户端导出 Skill 包 | 不猜测或写入客户端目录 |

`--client auto` 只选择已通过 Blocky 兼容矩阵的客户端。未知客户端不猜测目录，改为导出 Skill 包并提示用户查看该客户端文档。

## 5. Blocky Build Spec

Build Spec 是面向人和 Agent 的声明式 YAML/JSON 交换格式，不取代 `.blocky` 项目事实来源。最小结构：

```yaml
apiVersion: blocky.ai/v1alpha1
kind: BlockyProject
metadata:
  name: complaint-helper
target:
  runtime: blocky
modules:
  - id: assistant-module
    name: 投诉回复助手
    purpose: agent
    program:
      - id: agent-main
        type: core.agent.define
        with:
          name: 投诉回复助手
        do:
          - id: instructions
            type: core.agent.instructions
            with:
              text: 对投诉进行分类并起草回复，不自动发送。
interactions:
  - id: input-1
    type: core.interaction.chat_entry
    ownerAgentId: agent-main
    displayName: 输入 1
    capabilities:
      - type: core.interaction.accept_text
tools: []
customBlocks: []
permissions: []
appSurfaces: []
```

设计要求：

- `type` 必须来自当前 CLI 动态目录，不能由 Agent 自造。
- `modules` 使用稳定模块 ID；跨模块引用保存 `moduleId`/`exportId`，不按显示名猜目标。旧单程序 Spec 只作为显式迁移输入，不作为正式多模块事实源。
- 每个积木使用稳定 ID，支持差异定位和执行事件映射。
- 嵌套结构表达控制流，不退化为节点坐标或连线列表。
- 未识别的新字段进入保留区，旧 CLI 读取后不能静默删除。
- 导入前必须通过 JSON Schema 和 Blocky 语义校验。
- 交互入口、Tool 定义和两类自定义积木都有显式区段，但必须映射回画布中的稳定积木 ID，不能成为隐藏行为配置。
- Spec 不保存画布位置、密钥、运行日志和本机绝对路径；CLI 负责生成合理布局。
- `appSurfaces` 默认空；只有显式页面计划被接受后才增加条目。标签顺序、浏览器视口和最近关闭标签不属于 Build Spec。

## 6. 机器输出契约

所有读取命令支持 `--json`，流式事件使用 `--jsonl`。普通 stdout 只输出结果；诊断进入 stderr。

```json
{
  "schemaVersion": "blocky.cli/v1",
  "ok": true,
  "command": "project.validate",
  "data": {},
  "warnings": [],
  "artifacts": [
    { "path": "D:/work/assistant.blocky", "sha256": "..." }
  ],
  "nextCursor": null
}
```

要求：

- 列表默认限制数量，使用 `--limit` 和 `--cursor` 翻页。
- 大型原生配置、日志和运行轨迹写入文件，只在响应中返回路径、大小和 SHA-256。
- 错误包含稳定 `code`、人类可读 `message`、可定位 `path` 和可执行 `hint`。
- 退出码固定：`0` 成功、`2` 参数错误、`3` 校验失败、`4` 权限/权益不足、`5` 冲突、`6` 运行时不可用、`7` 部分完成、`10` 内部错误。
- JSON 字段只增不删；破坏性变更提升 `schemaVersion`。

## 7. 官方 Skills 包结构

首批四个官方 Skill 都采用开放 Agent Skills 格式：

```text
agent-skills/
  build-blocky-agents/
  create-blocky-blocks/
  convert-github-project-to-blocky/
  reverse-agent-to-blocky/
```

每个目录包含自己的 `SKILL.md`，并可按需包含 `agents/openai.yaml`、`references/` 与无密钥示例。Skill 不内置另一份编译器，所有确定性操作交给 `blocky` CLI。`SKILL.md` 保持简短，只包含触发范围和核心工作流；详细命令、Spec 和兼容规则按需读取。

四个入口分别覆盖：创建或修改 Blocky Agent；创建可视化/代码自定义积木；把 GitHub 项目转换为 Blocky；以证据映射方式逆向现有 Agent。`$convert-github-project-to-blocky` 是核心项目积木化入口，它可以把仓库中的清晰组件交给自定义积木服务，把多步通用能力交给蓝图服务，把完整 Harness 交给兼容草案服务。Pi、Codex、OpenCode、OpenClaw、Hermes、DeepSeek Harness 是官方兼容 fixture，不为其复制一套 Skill；Claude Code 先作为公开配置/扩展/行为研究 fixture。

## 8. Skill 必须执行的工作流

### 新建 Agent

1. 运行 `blocky doctor --json`。
2. 查询相关 `catalog` 与 `template`，不凭记忆编造积木 ID。
3. 创建 Build Spec，并先执行项目创建到新文件。
4. 运行 `project validate` 和模拟运行。
5. 返回项目路径、摘要、权限与未验证项。

### 修改 Agent

1. `project inspect` 后导出 Spec。
2. 保留稳定 ID 与未知字段，只修改用户要求范围。
3. 运行 `project diff`，向用户说明权限或行为变化。
4. 用户请求本地修改时应用带差异指纹的变更，再复验。
5. 未得到真实运行授权时停在模拟或计划阶段。

### GitHub 项目积木化

1. 运行 `doctor` 并读取积木目录、蓝图、类型和转换器版本，不凭 Skill 内容编造积木 ID。
2. 对远程仓库先生成锁定 ref 的不可变快照计划；对本地仓库记录当前 commit/dirty 状态，默认只读且不执行安装脚本。
3. 识别语言、入口、公开 API、数据流、状态、副作用、权限、依赖、许可证和性能热点，输出源码符号到 Blocky 语义的证据表。
4. 优先复用核心积木；在自定义积木、Blocky 蓝图、兼容模板草案和原生保留报告之间作出可解释选择，允许混合产物。
5. 对知识库/RAG 仓库优先映射 `core.knowledge.source/sync/embed/index/retrieve/rerank/compress/cite` 等通用积木；缓存、评估和权限复用既有语义，不生成框架品牌块。
6. 生成公开输入/输出、错误、权限、依赖、资源预算、来源 commit 和未覆盖项；运行确定性契约/性能夹具。
7. 通过 `convert diff` 展示幽灵差异；只有用户接受且差异指纹仍有效时才应用，再编译、校验和模拟。
8. 返回产物路径、证据覆盖、许可证/性能风险和未验证项；没有源码或许可证证据时只返回阻塞报告。

### 原生 Agent 与逆向

1. 先检测项目、上游版本和兼容等级。
2. 默认执行只读导入和差异分析。
3. 不直接编辑上游配置目录。
4. 写回、安装扩展和真实运行必须使用 Blocky 的授权引用。
5. 只报告当前组合已经通过的兼容等级。
6. 优先复用通用积木；无法解释的原生内容进入保留区，并输出源码/配置到积木的证据表与覆盖报告。

## 9. 权限与信任边界

- Skill 本身不获得额外权限；它只教 Agent 调用当前用户可执行的 CLI。
- `doctor`、目录、Schema、读取、校验、差异和模拟默认安全可用。
- 修改现有项目必须基于最新差异指纹，防止覆盖用户或其他 Agent 的并发修改。
- 真实模型、外部消息、删除、发布、系统设置、原生写回和设备动作需要短期、作用域明确、不可复用的授权引用。
- 授权引用由 Blocky UI 或受信任 Host 创建；CLI/Skill 不能自签发，也不能用 `--yes` 绕过。
- CLI 不从参数回显密钥，不在 JSON、日志、Spec 或 `.blocky` 中输出真实凭据。
- 通用 Agent 的沙箱与审批规则继续有效；Blocky Skill 不要求宿主关闭安全机制。

## 10. 版本与分发

- CLI、Core、Build Spec 和官方 Skill 分别有版本，但发行清单记录经过验证的组合。
- Skill 的主版本与最低 CLI 主版本匹配；版本不兼容时先停止并给出升级路径。
- Windows 应用内置一份只读官方 Skill，用户可复制到所选 Agent 的仓库级或用户级目录。
- 安装前展示目标路径、现有同名 Skill、将新增/替换的文件和哈希；默认不覆盖第三方同名目录。
- 官方发布包包含来源、版本、SHA-256 和许可证；CLI 的 `skill verify` 不把“文件格式正确”误报为“Blocky 官方签名”。
- 仓库级 Skill 适合团队版本锁定；用户级 Skill 适合个人在多个项目中调用。

## 11. 权益切分边界

当前先实现并验收完整 CLI、积木、Skills 和兼容能力，再单独设计教育基础、教育拓展与专业版权益。权益目录不能改变项目语义、文件格式或安全判断；任何版本都不能通过编辑 Spec 绕过权限。具体哪些 Skill、模板或高级能力属于哪个方案，本设计阶段不提前锁定。

## 12. 分期和验收

### 阶段 A：CLI Core

阶段 1 Demo 先以相同领域接口跑通本地锁定快照的 inspect/plan/diff；随后完成 `doctor`、Schema、目录、模板、Build Spec、项目创建/读取/差异/校验、模拟运行和完整 convert 命令。Demo 不在项目或 Schema 中引入专用字段。

### 阶段 B：内置搭建助手

实现默认审阅模式和带逐轮检查点的直接搭建模式，验证冲突拒绝、整轮撤销以及高风险动作仍需单独授权。

### 阶段 C：官方 Skills 包与插件

生成四个正式 Skill，使用真实 CLI 文档和样例；`$convert-github-project-to-blocky` 优先覆盖普通组件、RAG 项目和 Harness 三类失败夹具。通过 Codex 与至少一个其他 Agent Skills 兼容客户端的隔离测试。官方插件只连接这些既有能力。

### 阶段 D：运行 Host

加入真实模型运行、事件订阅、短期授权引用和 Windows 本地 IPC。

### 阶段 E：原生兼容

开放 Pi、Codex、OpenCode、OpenClaw、Hermes、DeepSeek Harness 的 `compat` 读取、导入、差异、报告，再按兼容模板与 ADR-002 的共同门槛逐个开放写回。

验收门槛：

- 同一个 Build Spec 经 CLI 和桌面应用打开后得到相同 Blocky IR。
- CLI 修改后，画布可打开、积木 ID 稳定且未知内容未丢失。
- 交互入口生成相同 `InteractionManifest`；没有入口时运行栏禁用，多入口保持稳定 ID、名称和独立草稿。
- Tool 引用调用和显式调用共享同一 Schema、权限、错误与结果事件。
- JSON/JSONL 输出通过固定 Schema，列表可分页，大对象只返回文件路径。
- Agent 能在无隐藏答案的测试中独立完成新建、修改、自定义积木、GitHub 转换、逆向和六类只读兼容导入。
- GitHub 转换至少覆盖：一个单组件仓库生成自定义积木、一个 RAG 仓库生成通用积木蓝图、一个 Harness 生成兼容草案，以及许可证/源码不足时只输出阻塞报告。
- 未授权测试中，Agent 无法触发真实外部副作用、原生写回或权益绕过。
- Skill 从应用内置副本安装到干净仓库后，可被目标客户端发现且版本校验通过。

## 13. 官方依据

- OpenAI 官方说明 Skill 由 `SKILL.md`、可选脚本、引用和资源组成，并可由 Codex 显式或隐式触发：<https://learn.chatgpt.com/docs/build-skills>
- OpenAI 官方建议 Agent 友好 CLI 提供可组合命令、可预测 JSON、分页、文件导出、清晰认证检查，以及写入前授权边界：<https://learn.chatgpt.com/use-cases/agent-friendly-clis>
- Agent Skills 开放标准与渐进加载方式：<https://agentskills.io/home>
- Agent Skills 完整格式、命名、目录与验证约束：<https://agentskills.io/specification>
- Codex 开放仓库、Claude Code 扩展能力与 OpenClaw Tools：<https://github.com/openai/codex>、<https://code.claude.com/docs/en/features-overview>、<https://docs.openclaw.ai/tools>
- LangChain 模块化 Retrieval 与 Qdrant 混合查询/过滤/生产优化：<https://docs.langchain.com/oss/python/langchain/retrieval>、<https://qdrant.tech/documentation/search/hybrid-queries/>、<https://qdrant.tech/documentation/production-checklist/>

## 2026-10-01 内置代码 Agent

桌面构建助手与`coding run <file.blocky> --module <id> --prompt <text> --output <result.json> --json`共用Pi/Host工具，模型沿用默认资源或`--model`。`--workspace`在本次原生helper中显示目录选择，不接受模型传来的目录字符串作为授权。可用`--conversation`传入有界角色/正文历史；新命令/Schema由command list、schema发现。旧`builder`仍兼容。

内置`blocky_cli`调用锁定bundle与原生存储helper，仅开放确定性发现、项目候选修改/校验/编译/补丁与模拟预检；不递归调用模型、不运行任意Shell。`$project`是当前未保存项目的隔离候选；`$json:<JSON>`提供有界补丁/操作工件。项目结果保持`applied:false`，桌面显式审阅后再应用。

共享契约与验证边界见[契约17](../技术设计/正式契约/17-内置代码Agent与Host工具.md)。源码可发现不代表Windows原生或新普通包已验收。
