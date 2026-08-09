# Blocky CLI 与官方 Agent Skill 产品设计

| 项目 | 内容 |
|---|---|
| 版本 | v0.1 |
| 日期 | 2026-08-09 |
| 状态 | 产品与命令面设计已确认，尚未实现 |
| 命令名 | `blocky` |
| 官方 Skills 入口 | `$build-blocky-agents`、`$create-blocky-blocks`、`$convert-github-project-to-blocky`、`$reverse-agent-to-blocky` |
| 首发环境 | Windows；从任意本地项目目录调用 |

> 更新说明（2026-08-09）：官方集成已从单一 `$build-blocky-agents` Skill 扩展为 Skills 包与 Codex 等客户端的官方插件，新增“自定义积木创建”“GitHub 项目转 Blocky”和“现有 Agent 逆向积木”。本文的 CLI、Build Spec、差异和授权原则继续有效；最新 Skills 组成、图形页协作与逆向规则见[《Blocky 完整积木与 Agent 兼容设计》](Blocky-完整积木与Agent兼容设计.md)。

## 1. 产品目标

Blocky 除图形编辑器外，提供一套稳定的 CLI 和一套官方 Agent Skills，使 Codex、Claude Code 及其他兼容 Agent Skills 开放标准的通用 Agent 能辅助用户搭建 AI 程序。本文后续章节详细设计其中的 `$build-blocky-agents`；其余 Skills 和官方插件以上位设计为准。

两者分工明确：

- `blocky` CLI 是机器接口，负责确定性读取、创建、编译、校验、差异、模拟、运行和兼容适配。
- `$build-blocky-agents` 是工作方法，告诉通用 Agent 何时调用哪些命令、如何控制上下文，以及哪些操作必须先展示差异或取得授权。
- Blocky 桌面应用仍是积木画布、权限确认和可视化调试的主要入口。

CLI 与 Skill 不提供第二套 Agent 语言，也不允许通用 Agent 绕过 Blocky 的类型、权益、安全和兼容性规则。

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
- OpenClaw/Hermes 只读扫描、原生往返和兼容报告。
- 经 Blocky UI 授权的真实运行、外部行动和远程实例控制。
- macOS CLI；Windows 以外平台的发行包在对应桌面端适配时加入。

Android 与 HarmonyOS 不提供设备本地 CLI。手机项目可以由电脑上的通用 Agent 通过 `blocky` CLI 修改，再由 Blocky 跨端打开；远程运行仍走兼容运行时协议。

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

### 运行和观察

| 命令 | 作用 | 关键约束 |
|---|---|---|
| `blocky run plan <file> --json` | 列出将使用的模型、数据、权限、预算和副作用 | 不执行 |
| `blocky run start <file> --simulate --jsonl` | 使用确定性模拟模型运行 | 第一阶段唯一可无额外授权运行的模式 |
| `blocky run start <file> --live --approval-ref <ref> --jsonl` | 真实运行 | 后续实现；授权引用由 Blocky UI 创建 |
| `blocky run watch <run-id> --jsonl` | 订阅积木级事件 | 支持断点续传序号 |
| `blocky run stop <run-id> --json` | 请求停止运行 | 仅作用于指定运行 ID |

### OpenClaw 与 Hermes

| 命令 | 作用 | 默认行为 |
|---|---|---|
| `blocky compat detect --runtime <name> --json` | 检测上游实例、版本和连接模式 | 只读 |
| `blocky compat inspect --runtime <name> --json` | 读取能力、配置摘要和兼容等级 | 只读、脱敏 |
| `blocky compat import --runtime <name> --output <file>` | 将原生实例投影为 Blocky 项目 | 默认不写原生目录 |
| `blocky compat diff <file> --runtime <name> --json` | 比较积木项目与原生状态 | 只读 |
| `blocky compat export <file> --runtime <name> --dry-run --json` | 生成原生写回计划 | 默认只能 dry-run |
| `blocky compat report <file> --json` | 输出版本组合和 L0-L4 证据 | 不提升兼容等级 |

原生写回后续只通过带 Blocky 作用域授权的命令开放。CLI 不提供直接修改 OpenClaw/Hermes 数据目录的快捷命令。

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
kind: BlockyProgram
metadata:
  name: complaint-helper
target:
  runtime: blocky
  edition: professional
program:
  - id: start
    type: core.when-run
    do:
      - id: ask-message
        type: core.ask-user
        with:
          prompt: 粘贴一条客户消息
permissions: []
```

设计要求：

- `type` 必须来自当前 CLI 动态目录，不能由 Agent 自造。
- 每个积木使用稳定 ID，支持差异定位和执行事件映射。
- 嵌套结构表达控制流，不退化为节点坐标或连线列表。
- 未识别的新字段进入保留区，旧 CLI 读取后不能静默删除。
- 导入前必须通过 JSON Schema 和 Blocky 语义校验。
- Spec 不保存画布位置、密钥、运行日志和本机绝对路径；CLI 负责生成合理布局。

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

## 7. 官方 Skill 结构

官方 Skill 名为 `build-blocky-agents`，发行时采用开放 Agent Skills 格式：

```text
build-blocky-agents/
  SKILL.md
  agents/
    openai.yaml
  references/
    cli-reference.md
    build-spec.md
    compatibility.md
  assets/
    examples/
      basic-assistant.blocky.yaml
      openclaw-readonly-import.blocky.yaml
      hermes-readonly-import.blocky.yaml
```

Skill 不内置另一份编译脚本，所有确定性操作交给 `blocky` CLI。`SKILL.md` 保持简短，只包含触发范围和核心工作流；详细命令、Spec 和兼容规则按需读取。`agents/openai.yaml` 只承载 Codex/ChatGPT 的显示元数据，不成为其他客户端使用 Skill 的前提。

建议触发描述覆盖：创建或修改 Blocky Agent、检查 `.blocky` 项目、将自然语言转换为能力积木、调试 Blocky 校验、积木化导入 OpenClaw/Hermes。

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

### OpenClaw/Hermes

1. 先检测项目、上游版本和兼容等级。
2. 默认执行只读导入和差异分析。
3. 不直接编辑上游配置目录。
4. 写回、安装扩展和真实运行必须使用 Blocky 的授权引用。
5. 只报告当前组合已经通过的兼容等级。

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

## 11. 教育版与专业版

- 官方 Skill 免费提供，不把提示词本身作为专业版付费墙。
- CLI 根据项目模式和授权返回可用积木；Agent 无法通过写 Spec 解锁专业积木。
- 教育版默认只允许课程积木、模拟模型和教师策略允许的本地文件范围。
- 专业版开放高级积木目录和原生兼容模板，但危险行动仍逐项授权。
- 教师可以让通用 Agent 解释作品结构或生成草稿，但课程提交必须保留“由 Agent 辅助”来源标记，具体教学政策后续单独设计。

## 12. 分期和验收

### 阶段 A：CLI Core

完成 `doctor`、Schema、目录、模板、Build Spec、项目创建/读取/差异/校验和模拟运行。它与 Blocky 语言尖峰一起实施，用于自动化测试核心语义。

### 阶段 B：官方 Skill

生成 `build-blocky-agents` 正式目录，使用真实 CLI 文档和样例；通过 Codex 与至少一个其他 Agent Skills 兼容客户端的隔离测试。

### 阶段 C：运行 Host

加入真实模型运行、事件订阅、短期授权引用和 Windows 本地 IPC。

### 阶段 D：原生兼容

开放 OpenClaw/Hermes 的 `compat` 读取、导入、差异、报告，再按 ADR-002 门槛开放写回。

验收门槛：

- 同一个 Build Spec 经 CLI 和桌面应用打开后得到相同 Blocky IR。
- CLI 修改后，画布可打开、积木 ID 稳定且未知内容未丢失。
- JSON/JSONL 输出通过固定 Schema，列表可分页，大对象只返回文件路径。
- Agent 能在无隐藏答案的测试中独立完成新建、修改、错误修复和只读兼容导入。
- 未授权测试中，Agent 无法触发真实外部副作用、原生写回或权益绕过。
- Skill 从应用内置副本安装到干净仓库后，可被目标客户端发现且版本校验通过。

## 13. 官方依据

- OpenAI 官方说明 Skill 由 `SKILL.md`、可选脚本、引用和资源组成，并可由 Codex 显式或隐式触发：<https://learn.chatgpt.com/docs/build-skills>
- OpenAI 官方建议 Agent 友好 CLI 提供可组合命令、可预测 JSON、分页、文件导出、清晰认证检查，以及写入前授权边界：<https://learn.chatgpt.com/use-cases/agent-friendly-clis>
- Agent Skills 开放标准与渐进加载方式：<https://agentskills.io/home>
- Agent Skills 完整格式、命名、目录与验证约束：<https://agentskills.io/specification>
