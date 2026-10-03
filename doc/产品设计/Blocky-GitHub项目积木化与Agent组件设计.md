# Blocky GitHub 项目积木化与 Agent 组件设计

| 项目 | 内容 |
|---|---|
| 版本 | v0.1 设计基线 |
| 日期 | 2026-08-23 |
| 状态 | 已确认方向；尚未实现转换引擎、官方 Skill 或真实兼容 |
| 核心入口 | `$convert-github-project-to-blocky` |
| 适用产物 | 自定义积木、Blocky 蓝图、兼容模板草案、原生保留报告 |

## 1. 核心决策

`$convert-github-project-to-blocky` 是 Blocky 官方 Skills 库的核心“项目积木化”入口。它不把任意仓库机械地画成几百块，也不把一段提示词包装成“转换成功”，而是基于锁定的源码证据判断最合适的 Blocky 产物：

1. **自定义积木**：适合边界清晰、输入输出稳定、可独立测试的库或组件。
2. **Blocky 蓝图**：适合由多步通用能力组成、用户仍需展开学习和改造的流程。
3. **兼容模板草案**：适合具有独立运行循环、会话、权限、插件和状态的 Agent Harness（智能体运行框架）。
4. **原生保留报告**：适合许可证不允许转换、源码不完整、动态行为无法安全静态解释或性能上必须保留原生实现的部分。

四类结果可以同时出现。例如一个 RAG 仓库可生成“文档加载器”自定义积木、“知识问答”蓝图、向量数据库适配资源和一份未覆盖功能报告。

转换产物必须复用 Blocky 的通用积木语义。上游项目名只出现在来源、兼容详情、许可证和开发者诊断中，不进入普通核心积木 ID 或面向小学生的主标题。

## 2. 与其他官方 Skills 的边界

| Skill | 负责内容 | 不负责内容 |
|---|---|---|
| `$convert-github-project-to-blocky` | 读取锁定的 GitHub 项目快照，提取可复用能力，规划并生成积木/蓝图/兼容草案 | 不直接修改 `.blocky`、不运行未审查安装脚本、不把全部仓库塞进代码积木 |
| `$create-blocky-blocks` | 根据已经明确的契约创建可视化或代码自定义积木 | 不负责判断一个完整仓库应拆成哪些产品能力 |
| `$build-blocky-agents` | 用既有积木、蓝图和资源搭建或修改作品 Agent | 不负责逆向上游源码和许可证判断 |
| `$reverse-agent-to-blocky` | 对已经运行或已有配置的 Agent 做结构/配置/行为证据映射 | 不把普通库或通用组件仓库当成完整 Agent Harness |

转换 Skill 可调用后三者的共享领域服务，但不能在内部复制第二套积木生成器、编译器或兼容分析器。

## 3. 输入分型与产物选择

### 3.1 仓库分型

| 输入类型 | 识别证据 | 默认产物 |
|---|---|---|
| 单一库或 SDK | 导出 API、类型、纯函数/服务边界清晰 | 一个或多个自定义积木 |
| 连接器或 Provider | 认证、请求 Schema、错误、限流和网络域清晰 | 资源类型 + 工具/知识积木适配 |
| 工作流或示例应用 | 多步数据流、状态和人工确认清晰 | 可展开 Blocky 蓝图 |
| 知识库/RAG 项目 | 摄取、分段、索引、检索、重排和引用链路 | 通用知识积木映射 + 蓝图 + 存储适配器 |
| Agent Harness | 自有 Agent 循环、工具策略、会话、权限、插件和事件 | 版本化兼容模板草案 |
| 混合仓库/monorepo | 同时包含库、应用、插件和运行时 | 分层产物，不强迫单选 |

### 3.2 选择规则

- 优先复用现有核心积木；只有稳定、可测试且跨项目可复用的新语义才进入自定义积木。
- 只组合现有语义但需要降低上手难度的，保存为 Blocky 蓝图，不增加运行原语。
- 需要上游运行时才能保持行为、性能或许可证边界的，使用兼容适配器和原生保留区。
- 无法证明输入、输出、权限、错误或来源的内容不得生成可运行产物，只生成诊断。
- 代码自定义积木必须声明依赖、沙箱、权限、网络域、资源预算和许可证；代码有效时显示绿色状态，警告显示黄色，无效显示红色，并有非颜色文字与图标。

## 4. 转换证据链

转换按以下顺序执行，所有会改变项目的操作都停在可审查差异前：

```text
仓库 URL / 本地快照
→ 锁定 owner、repo、commit、许可证和子目录
→ 只读清单与依赖扫描
→ 识别入口、类型、数据流、副作用、状态和性能热点
→ 建立源码符号到 Blocky 语义的证据映射
→ 选择自定义积木 / 蓝图 / 兼容草案 / 原生保留
→ 生成契约、权限和基准测试计划
→ Build Spec 与幽灵积木差异
→ 用户接受或拒绝
→ 编译、校验、确定性测试与性能基线
```

每次转换至少输出：

- `SourceSnapshot`：仓库、commit、子目录、依赖锁、许可证摘要和源码摘要；
- `ConversionEvidenceMap`：源码文件/符号/配置字段到积木、蓝图或保留项的定位；
- `ConversionPlan`：产物类型、公开接口、权限、错误、资源和未覆盖项；
- `CompatibilityReport`：已映射、部分映射、原生保留、阻塞和未知内容；
- `PerformanceBudget`：加载、编译、运行、内存、网络、索引和缓存预算；
- `SemanticPatch`：只通过 Blocky Build Spec 和版本化语义补丁表达的可审查改动。

## 5. 知识库与 RAG 的具体积木设计

首个真实 Agent 组件纵切使用现有通用积木，不新增 LangChain、LlamaIndex、Haystack、Qdrant 或 Chroma 品牌块。

### 5.1 摄取链

| 步骤 | 既有积木 | 必须可配置的字段 | 运行证据 |
|---|---|---|---|
| 定义知识库 | `core.knowledge.define` | 存储资源、索引方式、命名空间、保留策略 | 知识库引用、版本、容量 |
| 添加来源 | `core.knowledge.source` | 文件/URL/仓库/数据库、包含/排除规则、权限范围 | 来源 ID、commit/ETag、许可 |
| 增量同步 | `core.knowledge.sync` | 新增/更新/删除策略、冲突处理、批大小 | 新增/更新/删除/跳过数量 |
| 解析 | `core.document.parse` | 解析器、格式、页码/标题/代码结构保留 | 结构化文档与定位信息 |
| 清理 | `core.document.clean` | 去噪、重复、语言和敏感内容规则 | 规则命中与保留比例 |
| 分段 | `core.document.chunk` | 策略、长度、重叠、标题/代码边界 | 片段 ID、来源位置、Token 估算 |
| 向量化 | `core.knowledge.embed` | 模型资源、维度、批大小、重试和缓存 | 模型/维度/批次/失败项 |
| 写入索引 | `core.knowledge.index` | 向量/关键词/混合索引、幂等键和元数据 | 写入摘要、索引版本和耗时 |

### 5.2 检索与回答链

| 步骤 | 既有积木 | 必须可配置的字段 | 运行证据 |
|---|---|---|---|
| 检索 | `core.knowledge.retrieve` | 关键词/向量/混合模式、Top-K、分数阈值、元数据/ACL 过滤 | 查询、候选数、过滤原因和分数 |
| 重排 | `core.knowledge.rerank` | 规则/模型、候选上限、超时和降级 | 排名变化、耗时和降级状态 |
| 压缩上下文 | `core.knowledge.compress` | Token 预算、去重、摘录/摘要策略 | 保留片段、删除原因和预算 |
| 生成回答 | 现有 Prompt/Context/Model 积木 | 模型资源、结构化输出和失败回退 | 模型参数、上下文来源和输出 |
| 加入引用 | `core.knowledge.cite` | 引用样式、最低证据、缺证据策略 | 来源、页码/行号/URL 和覆盖率 |

查询改写、HyDE、多路检索和 Agentic RAG 默认做成可展开蓝图；只有跨项目稳定且不能用现有 Prompt、模型、并行和检索积木表达时，才评估新核心积木。缓存复用 `core.flow.cache`，质量评估复用 `eval.test_case` 与 `eval.score`，权限复用“护栏与权限”积木和检索的 ACL 过滤输入。

### 5.3 首批 RAG 蓝图

| 蓝图 | 面向用户的任务 | 展开结构 |
|---|---|---|
| 资料问答伙伴 | 从本地资料回答并标明出处 | 来源 → 同步 → 分段 → 索引 → 检索 → 引用 → 回答 |
| 代码库讲解助手 | 根据仓库文档和代码解释模块 | 仓库来源 → 代码结构解析 → 混合检索 → 重排 → 引用 |
| 课堂知识小老师 | 使用教师锁定资料回答，缺证据时拒答 | 受控来源 → ACL 过滤 → 检索 → 护栏 → 引用 → 回答 |
| 客服资料助手 | 从产品手册检索答案并生成草稿 | 多来源同步 → 检索 → 置信度 → 人工确认 → 输出 |

## 6. 开源项目与 Harness 夹具策略

夹具是设计和测试输入，不自动成为 Blocky 依赖或品牌积木。立项时必须重新锁定 commit、依赖、许可证和最小可重现用例。

### 6.1 Agent 组件候选夹具

- [LangChain Retrieval](https://docs.langchain.com/oss/python/langchain/retrieval)：验证加载、分段、Embedding、Vector Store、Retriever 以及 2-step/Agentic/Hybrid RAG 的通用映射。
- [LlamaIndex](https://github.com/run-llama/llama_index)：验证摄取、索引、查询引擎与数据连接器的映射。
- [Haystack](https://github.com/deepset-ai/haystack)：验证组件管线、Document Store、Retriever 和 Ranker 的组合边界。
- [Qdrant](https://github.com/qdrant/qdrant)：验证混合查询、过滤、批写入、索引与重排的性能适配，不把数据库内部实现复制进项目 JSON。
- [Chroma](https://github.com/chroma-core/chroma)：验证本地知识存储和集合生命周期适配。

### 6.2 Harness 夹具分级

| Harness | 当前证据用途 | 转换策略 |
|---|---|---|
| Codex | 官方开放仓库、CLI/SDK、Skills、MCP、AGENTS.md、沙箱与审批 | 作为公开架构和来源研究材料；Codex 官方 Blocky 插件仍是独立产品方向，不意味着 Codex 项目起点 |
| Claude Code | 官方文档描述 CLAUDE.md、Skills、Subagents、MCP、Hooks、Plugins；公开仓库含分发与插件资料 | 作为配置/行为/扩展研究来源，不据此承诺源码转换或内置蓝图 |
| OpenClaw | 官方开放仓库、Gateway、Workspace、Tools、Skills、Plugins、Channels | 作为研究来源；本项目不据此提供运行适配或软件起点 |
| Pi | SDK、真实 Agent 循环、上下文和工具语义 | Pi Agent 是第四类起始蓝图；必须锁定真实上游版本/许可证并将核心运行语义积木化，不能以自有循环改名替代 |
| OpenCode、Hermes、DeepSeek Harness | 各自公开项目、架构与配置 | 仅作为研究来源；不再处于当前软件模板或兼容适配交付队列 |

Codex、Claude Code、OpenClaw、OpenCode、Hermes 和 DeepSeek Harness 可继续用于研究 Agent 落地场景中的仓库规则、Skills、工具/MCP、权限、子 Agent、Hooks/插件、会话和事件语义。研究不能自动升级为产品支持或兼容结论；当前产品起点固定为四类可改造蓝图。Pi SDK 作为现有构建助手的内置引擎与 Pi Agent 蓝图来源是两个不同使用边界。

## 7. 兼容性设计

- 转换器只生成 Blocky 通用语义和版本化自定义契约，不生成框架品牌核心积木。
- 自定义积木公开接口使用 Blocky 类型系统；语言特有类型进入适配层，不泄漏到普通画布连接。
- 上游未知字段、插件配置和无法映射的步骤使用可定位原生保留区；导出时保持顺序、默认值和未知内容。
- 每个产物记录来源 commit、转换器版本、积木目录版本、Build Spec 版本和最低运行时版本。
- 上游升级先生成结构/配置/行为差异，再决定迁移、继续锁定或降级；不自动覆盖用户修改。
- 兼容结论按“结构已映射、配置可往返、行为已对照、已验证完整兼容”分别展示。

## 8. 性能设计

### 8.1 转换性能

- 先读取清单、语言统计和依赖图，再按需解析相关子树；大仓库不一次性塞入模型上下文。
- 以 commit + 路径 + 内容摘要缓存语法树和符号索引；文件未变时增量复用。
- 识别代码生成目录、依赖目录、二进制和大文件，默认排除并在证据表中说明。
- 大型证据、AST 和日志写入工件文件；CLI JSON 只返回路径、大小、SHA-256 和摘要。
- 分析、规划、生成和基准测试可取消、可恢复，并有文件数、字节数、耗时和内存上限。

### 8.2 RAG 运行性能

- 文档同步使用稳定来源 ID 和内容摘要，只重算变更片段；删除和权限变化必须传播到索引。
- Embedding 和索引写入支持批处理、并发上限、背压、重试和部分失败报告。
- 向量索引、原始文档和大型缓存保存在受控资源存储中，项目 JSON 只保存资源引用和版本。
- 检索先用低成本候选召回，再在受控候选集上重排；Top-K、重排上限、Token 预算和超时显式可见。
- 常用元数据/ACL 字段建立索引；未索引过滤在正式模式下可配置为警告或拒绝。
- 性能验收至少分小型课堂资料、中型团队知识库、大型代码仓库三档，并分别记录冷启动、增量同步、P50/P95 检索、内存和索引体积。

## 9. 第一开发阶段的可展示 Demo

阶段 1 使用正式 monorepo 的最小纵切，不在尖峰目录上改名，也不创建第二套临时项目格式。Demo 固定跑通：

1. 从“资料问答伙伴”蓝图创建项目；
2. 修改角色、知识来源和回答风格；
3. 使用固定本地文档夹具完成确定性检索和带引用回答；
4. 运行时对应积木绿色亮起，警告黄色，错误红色，并可在运行轨迹中跳回来源；
5. `Shift + 左键` 多选或框选一段积木，保存为个人蓝图并重新插入；
6. 打开模型/知识积木配置，看到 Provider、Base URL、模型 ID 和密钥引用位置，但本阶段不要求真实密钥；
7. 对锁定的本地 GitHub 项目快照执行“扫描 → 证据 → 自定义积木或蓝图建议 → 幽灵差异 → 接受”；
8. 保存、关闭、重开，确认积木、来源、蓝图和运行记录摘要保持一致。

阶段 1 的版本说明、开发计划和验收结论明确称其为 Demo 即可。产品界面、项目文件、运行事件和设置 Schema 不增加“演示数据”“Demo Provider”等徽标、横幅、水印、持久字段或专用条件分支。固定夹具和确定性 Provider 必须走正式接口，后续以真实实现替换；不得用录屏脚本、静态卡片或预写回答冒充已完成的模型/RAG/兼容能力。

## 10. Demo 到真实能力的替换账本

| Demo 能力 | 后续真实实现 | 完成标准 |
|---|---|---|
| 固定文档夹具 | 文件/URL/仓库来源、解析、增量同步 | 来源变更、删除和权限变化可验证传播 |
| 确定性检索 | 关键词/向量/混合检索与重排 | 质量集、P50/P95、过滤和降级通过 |
| 本地确定性 Provider | 真实 ModelProfile 与 Provider 适配 | 用户安全配置后 live 运行通过；无密钥仍可测试 |
| 固定 GitHub 快照 | 真实仓库获取、commit/许可锁定、增量扫描 | 可重放、可取消、证据完整且不运行安装脚本 |
| 预置转换建议 | 转换引擎与 `$convert-github-project-to-blocky` | 自定义积木/蓝图/兼容草案选择可解释并通过隔离测试 |
| 确定性运行轨迹 | 真实模型、工具、知识和 Harness 事件 | source map、脱敏、取消、错误和回放通过 |
| 设置占位项 | 真实 Schema、Host 安全存储和迁移 | 每项有消费者、作用域、默认值、迁移和重置测试 |

## 11. 分阶段落地顺序

1. **Demo 纵切**：固定本地知识与 GitHub 快照，验证端到端用户旅程和正式包边界。
2. **语言与资源地基**：稳定 Workspace/IR、知识资源引用、命令系统、设置和迁移。
3. **真实知识摄取**：文件/URL/仓库来源、解析、分段、增量同步、删除传播。
4. **真实检索与引用**：关键词优先，再加入可替换 Embedding、向量/混合检索、重排、引用和评估。
5. **真实项目积木化引擎**：本地仓库只读扫描、证据映射、产物决策、语义补丁和基准测试。
6. **官方 Skill 包装**：CLI 稳定后生成 `$convert-github-project-to-blocky`，在干净 Codex 会话和至少一个兼容客户端前向测试。
7. **Harness 适配**：Codex/OpenClaw 优先执行源码与行为夹具；Claude Code 先执行公开配置/扩展/行为夹具，再决定是否进入兼容模板。

每一步都先通过无密钥确定性测试。人工验收需要真实大模型 API 时，验收人员主动请求用户通过 Blocky 安全存储或本地 `.env` 配置；缺少凭据时 live 子项记录为“阻塞”或“未执行”，不能影响其他无密钥子项的真实结论。

## 12. 设计依据

- OpenAI Codex 开放仓库与官方 Skills/CLI/AGENTS.md：<https://github.com/openai/codex>、<https://learn.chatgpt.com/docs/build-skills>、<https://learn.chatgpt.com/docs/codex/cli>、<https://learn.chatgpt.com/docs/agent-configuration/agents-md>
- Claude Code 扩展能力与公开仓库：<https://code.claude.com/docs/en/features-overview>、<https://github.com/anthropics/claude-code>
- OpenClaw Tools 与 Agent Workspace：<https://docs.openclaw.ai/tools>、<https://docs.openclaw.ai/concepts/agent-workspace>
- LangChain Retrieval 对模块化 RAG 与 2-step/Agentic/Hybrid RAG 的说明：<https://docs.langchain.com/oss/python/langchain/retrieval>
- Qdrant 混合检索、过滤与生产优化：<https://qdrant.tech/documentation/search/hybrid-queries/>、<https://qdrant.tech/documentation/search/filtering/>、<https://qdrant.tech/documentation/production-checklist/>

这些资料用于确定通用语义和测试夹具，不等于 Blocky 已完成任何第三方兼容、许可证审计或商业集成。
