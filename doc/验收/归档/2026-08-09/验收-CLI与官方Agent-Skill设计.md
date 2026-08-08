# CLI 与官方 Agent Skill 设计验收

## 汇总

| 项目 | 内容 |
|---|---|
| 任务 | 为 Blocky 增加供 Codex 等通用 Agent 辅助搭建的 CLI 与官方 Skill 设计 |
| 涉及模块 | 命令面、Build Spec、机器输出、差异与授权、Skill 格式、客户端安装、原生兼容入口 |
| 验收等级 | L1（产品与技术文档，无 CLI/Skill 实现） |
| 验证结果 | 通过 |
| 问题风险 | CLI 和 Skill 尚未实现；跨客户端支持只能按实际兼容测试结果声明 |
| 最终结论 | 通过 |

## 详细报告

### 1. 产品需求覆盖

验证步骤：

1. 检查是否定义稳定命令名和官方 Skill 名。
2. 检查通用 Agent 是否能完成积木目录发现、项目创建、修改、校验、模拟、运行观察和 OpenClaw/Hermes 兼容任务。
3. 检查 CLI 与 Skill 是否复用 Blocky 的语言、权益、权限和兼容规则。
4. 检查教育版、专业版和各平台边界。

预期结果：上述能力均有明确入口；不创建隐藏流程或语义旁路。

验证结果：通过。命令名为 `blocky`，官方 Skill 为 `$build-blocky-agents`；Windows 首发，Android/HarmonyOS 不提供本地 CLI；教育与专业权益由同一 Core 校验。

### 2. Agent 友好接口

验证步骤：

1. 检查读取命令是否支持稳定 JSON，事件是否支持 JSONL。
2. 检查列表分页、大对象文件导出、错误码、退出码和 artifact 路径。
3. 检查 Build Spec 是否可读、可校验、能表达嵌套积木并保持稳定 ID。
4. 检查修改是否具有 diff/base/spec 摘要和并发冲突保护。

预期结果：通用 Agent 可以用小而稳定的上下文完成发现、精确读取、修改和验证，且不会直接操作 `.blocky` 内部格式。

验证结果：通过。产品与 ADR 已定义 JSON Envelope、JSONL Event、分页、Schema、稳定退出码、Build Spec 和三摘要差异指纹。

### 3. 权限与副作用

验证步骤：

1. 检查只读、项目写入、模拟运行、真实运行和外部副作用是否分层。
2. 检查 Skill 是否能自行签发授权或用统一确认参数绕过权限。
3. 检查 OpenClaw/Hermes 是否只能通过 ADR-002 兼容适配器操作。

预期结果：本地项目修改可审查并防冲突；真实外部行动必须使用短期、作用域明确、单次使用的授权引用。

验证结果：通过。设计明确不存在通用 `--yes` 越权路径，授权由 Blocky UI/Host 保存和校验；CLI/Skill 不直接改上游目录。

### 4. Skill 标准与分发

验证步骤：

1. 对照 OpenAI 官方 Skill 文档与 Agent Skills 开放标准。
2. 检查 `SKILL.md`、`references/`、`assets/` 和可选 `agents/openai.yaml` 的职责。
3. 检查 Skill 安装是否 dry-run 优先、避免覆盖同名第三方或用户修改内容。
4. 检查来源验证是否区分格式有效、哈希匹配和官方签名状态。

预期结果：Skill 可被兼容客户端渐进加载，并且不虚构客户端支持或官方签名。

验证结果：通过。Codex 是首个正式目标；其他客户端只有在兼容矩阵通过后才声明支持，未知客户端仅导出标准 Skill 包。

### 5. 文档质量与安全

验证命令/步骤：

```powershell
git diff --check
# 递归检查 Markdown 相对链接
# 检查 CLI、Build Spec、差异、授权、兼容和 Skill 关键术语
# 扫描常见 API Key、GitHub Token、Bearer Token 与私钥头
```

预期结果：无 Git 空白错误、无失效相对链接、关键内容齐全、无疑似真实密钥，且未创建未经授权的 `AGENTS.md`。

验证结果：通过。文档链接、关键内容、敏感信息和授权边界检查均通过；Git 仅提示 Windows CRLF 转换，不影响内容。

## 风险与后续门槛

- 本任务是接口和产品设计，不代表 `blocky` 命令或 `$build-blocky-agents` 已经可安装。
- Build Spec 仍为 `v1alpha1`，必须经过 Core/Workspace 往返测试后再稳定。
- Windows 命令入口的应用内置运行环境与 PATH 安装方式需技术尖峰验证。
- Skill 正式生成必须基于真实 CLI 行为，不能先发布只靠提示词猜积木结构的版本。
- 跨客户端宣传需要独立发现、命令执行、审批和产物验证证据。

## 最终结论

本次 L1 设计验收通过。CLI、Build Spec、官方 Skill、差异与审批协议均已形成可实施边界；下一阶段应随 Blocky Core 尖峰先实现无副作用的 CLI Core，再生成并前向测试正式 Skill。
