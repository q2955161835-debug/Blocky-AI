# 阶段 4 Agent 语义闭环

本契约描述 0.4.0 实现边界。正式结论由[阶段 4 任务验收](../../验收/任务/验收-2026-09-19-Blocky阶段4.md)给出。

## 语言与项目事实

继续使用 blocky.project/v1、既有 IR 和 Workspace。新执行语义将最低读取版本提升为 0.4.0；旧项目不自动联网或切换模型。“文本分析 Agent”与 CLI agent-loop 是同一可编辑示例，不增加第五个官方知识蓝图。

| 积木 | 执行语义 |
|---|---|
| core.prompt.context | 追加提示，累计限制 8192 UTF-8 字节 |
| core.run.budget | 收紧步数、调用数、输出 Token 预留和总时限，不允许放宽 |
| core.data.set | 将 JSON 常量写入当前结果，限制 32768 字节 |
| core.logic.condition | 根据 input/result/memory 的 equals/contains/truthy 仅执行 THEN 或 ELSE |
| core.memory.read/write/delete | 显式键值读、写、删，session 或 project 作用域 |
| core.tool.invoke | 按版本、权限和输入/输出 Schema 调用登记工具 |
| core.guardrail.evidence | 设置随后生成步骤的 require/optional 证据策略 |
| core.output.structured | 校验当前结果；非 string Schema 的文本先解析 JSON |
| core.output.file | 生成待保存的 UTF-8 text/json 工件，本步骤不写磁盘 |

原有 Event/Agent/Model/Knowledge/Output 共用编译器和运行内核。未知字段、枚举、资源、Schema 和实现引用不得静默跳过。输入上限 16000 字节，总上下文 32768 字节。角色和用户输入分离，记忆/知识/工具结果作为用户层数据，不提升为系统指令。此分层保护权限边界，不承诺模型绝不受提示注入影响。

## 模型与真实调用

AgentServices.generate 返回 text、provider、transport、实际 model、响应 requestId 和 usage。远程响应必须含有效 inputTokens/outputTokens/totalTokens 且三者一致；不能伪造为零。旧摘录适配器保留；generator-v1 是无网络整理器，deepseek-v1 才走 Host 真实请求。

用户作用域 ModelProfile 保存类型、模型、协议、超时、参数、实现及秘密引用。密钥只在 Rust Host 内从既有 DPAPI 存储读取，WebView/CLI 不获取秘密。固定 HTTPS 官方端点，禁用重定向及系统代理，无任意地址、额外请求头或 Shell 入口。支持 openai-chat 非流式响应，明确关闭思考模式，只接受一个 stop 完成结果，不自动重试。

2026-09-19 核对[官方模型页](https://api-docs.deepseek.com/quick_start/pricing/)和[思考模式说明](https://api-docs.deepseek.com/guides/thinking_mode/)后，本轮配置采用 deepseek-flash；配置名不代替 API 实际返回证据。每次输出最多 1024 Token，本轮用户授权最多 12 次真实请求。

blocky.provider-request/v1 绑定项目、资源、请求身份、模型、消息、预算、超时和可选温度。Host 独立校验用户资源绑定。401、429、5xx、畸形、过大及截断响应映射稳定错误，原始错误体不进入事件。原生确认显示模型、项目、输入大小和请求摘要，批准后才发出请求。

同一次运行中重复进入同一模型或知识积木时，调用身份包含运行内单调调用序号；不能只用 runId 与 blockId 组成请求编号。每次调用的 started/completed/failed 事件共用其 correlationId，不同调用分别批准，供应商响应 ID 独立保存。

## 工具、批准与记忆

首批工具 text.analyze/v1 在本机统计 Unicode 字符数、行数和空白分词数。它没有文件、网络、进程或用户 PTY 权限。资源必须采用 text-analyze-v1、version 1，permissions 和 capabilityRequirements 各只有 text.analyze；输入输出引用项目 schemas。工具 started/completed/failed 使用同一 correlationId，并继承 block/run 终态。

CLI Provider、工具及项目记忆先预检，再批准完整摘要。票据绑定项目、运行或会话、requestId 与参数，30 分钟有效，跨 helper 进程仅消费一次。消费/过期墓碑不自动删除，以免旧批准复活；账本上限 32768 条和 8MiB，满后明确拒绝。桌面工具采用原生确认；项目记忆令牌绑定项目/会话，结束、取消或退出时撤销。

session 记忆由 Runtime 实例管理，按项目/会话隔离，实例退出即消失。project 记忆保存在 Host 用户存储，同项目跨会话可读，不进入项目 JSON。单值 32768 字节，容量 1MiB；Host 使用互斥及临时文件原子替换。打开或恢复项目不重放写入；已经完成的写入不会因后续取消自动回滚。

## 预算、证据与输出

默认上限 2000 步、16 次调用、4096 输出 Token 预留和 120 秒，配置只能收紧。调用前预留预算，失败不退还。异步步骤受 AbortSignal 与总时限约束，停止后不消费迟到结果。Host 丢弃异步网络 future；受控取消要求两秒内收敛。本地停止不代表供应商停止计费。

require 策略在无证据时本地拒答。有证据时生成引用必须属于当前集合，并在生成后重新打开真实知识引用核验权限和版本。生成文本与原文分别展示；引用有效不等于自动证明每句话。非法结果不发布为成功输出，但已读回的真实用量仍保留为调用证据。

结构化输出支持有界 JSON Schema 子集：type、properties、required、additionalProperties(boolean)、items、enum、minimum/maximum、maxLength/maxItems 及说明字段。最多 16 层、1000 个 Schema 节点；未知断言一律失败。每次最多 8 个文件工件，每个 65536 字节；名称禁止路径穿越和 Windows 保留名。桌面经原生选择与覆盖确认保存；CLI --output 仅允许单一工件，采用同目录临时文件、刷新及不覆盖发布。失败/取消运行不返回待导出工件。

## 桌面、CLI 与恢复

运行面板可选择项目或用户模型，支持撤销；在线请求和工具经过 Host 原生确认。结果展示文字、JSON、保存入口及模型用量。

CLI run start 使用同一领域端口，显式选择 --simulate 或 --live，可用 --jsonl 查看事件。--interactive 对每个请求输入完整摘要批准，或通过 --approval-file 提供摘要数组。无批准退出 4、运行失败 3、取消 7。多次受控调用建议使用交互批准，已消费票据不可重新运行复用；--run-id 仅固定请求身份，不代表授权。

保存和恢复复用现有原子项目存储及恢复副本，只恢复编辑事实，不自动运行模型/工具。测试钩子与普通发行物隔离。实现入口为 runtime-core 的 agent-context/agent-execution/native-agent/budget/output-schema，Host 的 provider/agent_data/approval_ledger，桌面 RunModelChoice/RunOutputs，CLI run-agent/atomic-output。
