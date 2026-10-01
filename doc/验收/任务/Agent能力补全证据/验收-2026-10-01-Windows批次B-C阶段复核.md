# 验收：Windows 批次 B–C 阶段复核

独立验收 Agent：windows_bc_acceptance，sol / medium，未参与 B–C 实现。时间：2026-10-01 12:20 ~ 2026-10-01 12:49（Asia/Shanghai）。依据已确认 17 项任务验收与角色；本报告不代签 F、普通包或完整 A15/A16/A17。

## 汇总表格

| 用户功能 / 使用场景 | 项目项 / 等级 | 本阶段结果 | 证据定位 |
|---|---|---|---|
| 知识模型 / 真实 E5、MiniLM、神经重排及迁移回退 | A02 / L3 | 通过 | 详细报告 1 |
| 文档导入 / Windows 隔离解析、OCR、负例与取消 | A03 / L2 | 通过 | 详细报告 2 |
| 知识摄取 / 增量、撤权、共享 CLI 流程 | A04 / L3 | 通过（领域阶段） | 详细报告 3 |
| 资料问答 / 冻结问题集、真实模型判断及引用 | A05 / L2 | 通过 | 详细报告 4 |
| 自主办事 / 实际模型决定两次工具调用、控制流与停止 | A06 / L3 | 通过 | 详细报告 5 |
| 工具连接 / HTTP 与 MCP 协商、调用、权限、结算 | A07 / L3 | 有条件通过 | 详细报告 6：历史异常未归因 |
| 搭建与操作 / 连续追问及停止、项目隔离 | A15 / L2 | 相关共享领域通过；完整项未执行 | 详细报告 7 |

最终结论：**有条件通过**。当前 Windows 领域实测已完成，但两次旧 Host MCP `BLK-TOOL-OWNERSHIP` 尚未归因；不得依据本报告合并或发布。普通包原生 GUI、完整 Core/Full、三个核心作品和 F 最终验收仍待执行。

## 详细报告

### 来源与工件

- 云端产品基线 `be03f53`；Windows 解析 runtime 锁检查点 `5952495`；冻结语料 Windows 换行修复 `2f02b4b9d2a994eb76956729d7475b04b088eeb5`。未修改冻结题集正文或通过门槛。
- 初轮 CLI Host SHA256 `64d2b2b9c5b7b67453905d69a524b35cbdc49b68808f8783ce2963fed1968c0e`；MCP 集中复验使用增加安全错误细分诊断的 Host，SHA256 `63afc63c6e0622343a81621eda106c761b001be10f87e27d44e94798fd640bb5`、36455936 字节。诊断变更不视为行为修复。
- CLI JS SHA256 `66045bb41d6aefa2e1ec0ae0f483f372cff47083be34798279268ac2680cca92`；Windows 解析锁 SHA256 `553dbb6f45cccb5e5a80489d55dbfd20fe24ba0ebd18650f9afb85792e0e1052`。
- 真实模型测试重编译 debug Host；直接运行停止测试时工件 SHA256 `097c6d2916a51d8cc7c8d679ef1f51ef48acbb7d5127c3780df369e474413523`。此阶段不将并行 D–E 开发视为已验范围。
- 探针、日志与结构化回执根：`D:\1Folder\Blocky-AI\try\agent-capability-upgrade\windows-bc\`；工件清单 `source-manifest.json`。这些忽略目录材料不是普通交付包内容。
- 复用旧探针的 MCP JSON 中 `source: 0c98cb8` 是未更新的历史标签，不作为本轮来源；本轮依据本报告绑定的实际 Host SHA256、执行时间和清单。

### 1. 知识模型

#### 更换、回退与取消

显式执行 3 个真实推理 ignored 测试，3/3 通过：`real_model_migration_and_rerank_acl`、`real_model_semantics_windows_binary_cache_and_revocation`、`real_embedding_cancel_resumes_binary_checkpoint_and_rejects_corruption`。使用锁定 E5、MiniLM 和 ms-marco MiniLM 神经重排，均为本机 ONNX CPU 推理，没有外部模型 API。

两种 384 维嵌入建立独立签名，切换/回退后查询正确；错模型索引拒绝，撤权后迁移和重排拒绝；真实取消 16ms，续传 32 分块中复用 16、新嵌入 16，完整损坏向量拒绝。E5 工件 SHA256 `f80102d3f2a1229f387d3c81909990d8945513e347b0eab049f7de3c6f98c193`、revision `761b726dd34fb83930e26aab4e9ac3899aa1fa78`。证据：`models.log`。

### 2. 文档导入

#### 普通资料、扫描资料与受保护资料

通过当前 Windows CLI Host 的 `knowledge-read-source` 实际解析中英文本 PDF（2 段）、扫描 PDF（2 段）、中文 DOCX（3 段）、PNG OCR（2 段）、XLSX（2 单元格）、CSV（2 行）。核对中文正文及 `BLOCKY OCR 12345`，保存真实定位和 metadata；坏 PDF 返回 `BLK-DOCUMENT-INVALID`、不安全 DOCX 返回 `BLK-DOCUMENT-UNSAFE`。每文件约 31–33 秒，包含约 180MB 锁定 runtime 的隔离快照，未把直接 JS 解析当作 Host 证据。证据：`documents/results.json`。

另用本机 bundled pypdf 生成真实密码加密 PDF，Host 明确返回通用 `BLK-DOCUMENT-INVALID`，没有当空文档成功。生产解析器负例另验证缺 OCR 语言资源 `BLK-DOCUMENT-ASSET`、异常压缩 DOCX 被拒绝、超大图片 `BLK-DOCUMENT-LIMIT`。后三项是生产解析器边界测试，不冒充 AppContainer 实测；证据：`document-negative/results.json`。探针起初假设未声明的 PASSWORD 专用错误码，随后按生产已声明通用错误码纠正；未改产品源码。

#### 活跃解析停止及系统隔离

在真实活跃扫描 PDF 子进程上调用 Windows `GetTokenInformation(TokenIsAppContainer)` 与 `IsProcessInJob`，两者均为 true；通过独立 Host `knowledge-cancel` 停止，1468ms 完成结算，原 child 进程、session 目录和系统 AppContainer profile 均为 0/不存在。证据：`cancel/results.json`、`cancel-security.log`。

### 3. 知识摄取

#### 增量同步、权限与可编辑入口

当前共享 CLI 4 个测试通过，覆盖真实文件摄取、跨 CLI 进程持久化、重复同步跳过、修改增量更新、撤权清除、移除来源及 pipeline/preview 对齐。知识模型与预览组件专项和连续聊天组件合计 13/13 通过，包括迟到/旧状态处理；不将组件替身称为普通包 GUI。证据：`ingestion-cli.log`、`components.log`。普通包展开蓝图、原生分段预览、保存重开留到 F；此处仅领域阶段结论。

### 4. 资料问答

#### 冻结质量与真实证据判断

原 20 有证据、10 无证据、10 撤权语料 SHA256 `76270e2a5a96dafb397987957065d4b38c2eed62c54433b2dc6594ea92ddc9f0`，执行前校验。初轮 raw 检索有证据三策略均 20/20、引用有效 100%、撤权正文泄漏 0，但实际 no-evidence 为关键词 2/10、向量及混合 0/10。通用“待核实”文案不能替代真实不足判断；初轮记录保留于 `quality-1790829010763/report.json`。

原 evaluator 未连接作品已有的 `correctedQuery`/`AgentExecution.judgeKnowledge`，由主 Agent 接入同一生产路径；不改语料或门槛。补齐初始化后独立实际重跑：

| 策略 | 有证据 Top-5 命中 | 无证据正确不足 | 撤权问题失败 | 引用有效 | 撤权正文泄漏 |
|---|---:|---:|---:|---:|---:|
| 关键词 | 19/20 | 10/10 | 0/10 | 100% | 0 |
| 向量 | 20/20 | 10/10 | 0/10 | 100% | 0 |
| 混合 | 20/20 | 10/10 | 0/10 | 100% | 0 |

实际生成 123 条模型判断回执，生产纠正上限每例 1 次改写；向量 q25、混合 q33/q39 各有 2 条判断回执，其余每例 1 条。结合生产循环，这三例各发生 1 次重新检索；raw 查询单列而不计纠正循环。当前报告没有逐例保存 `correction` 对象，后续 evaluator 应保存该对象；不能把所有 `clarification=true` 解释为无证据正确。运行跨模块引用输出亦通过。

无秘密 API 证据：DeepSeek、实际模型 `deepseek-flash`，149854 输入 + 717 输出 = 150571 Token；123 个请求 ID、逐例绑定及用量见 `quality-1790829705864/report.json`。本项评估的是生产证据判断和有界纠正，回答输出仍为引用摘录，不宣称自由生成答案的蕴含正确性。

### 5. 自主办事

#### 模型自主决定工具与控制流

真 DeepSeek 完成 lookup → 返回动态随机 ticket → 模型选择 complete 并使用原 ticket → 模型结束，2 次实际 HTTP 副作用，3 次生成回执，累计 2099 Token（1830 输入、269 输出）。不是预排固定工具顺序。证据：`live.log` 与 `live/result-*.json`。

实际项目模块 foreach/条件分支、总预算拒绝、权限先于副作用、while/repeat、有界 retry/catch 五场景通过；工具停止组件 6/6、Native Operation 在 preflight 前及预览后取消拒绝审批/副作用测试 1/1 通过。证据：`module-flow.log`、`b/module-flow/results.json`、`tool-stop-components.log`、`native-stop.log`。本测试验证原生执行语义；不称已操控普通包停止窗口。

### 6. 工具连接

#### HTTP 与 MCP 的正常/失败闭环

HTTP 12 场景通过，覆盖实际 Unicode GET、输入/输出 Schema、审批绑定、非法目标、认证失败、安全错误、hang/EOF 取消、未知回执和人工明确结算，owned process 0。

旧 Windows CLI Host 上 MCP 两轮出现 `BLK-TOOL-OWNERSHIP`（第一轮 count，第二轮 read-resource）。未发现实际 worker 或 profile 泄漏；旧探针 workers 集为空时以 PID 0 检查，错误计入 Windows Idle，已纠正该探针统计。原失败日志保留 `mcp.log`、`mcp-recheck.log`。

增加错误细分诊断后的新 Host，连续两轮最小跨进程 discover/read/count 和一轮完整 8 场景全部通过：stdio/Streamable HTTP 协商、发现、资源读取、调用、反向请求拒绝、伪响应 ID、服务退出、越界资源、bundle 变更使审批失效；sandbox 六边界正确（外部读、子进程、bundle 写、联网、Host 环境均拒绝，私有工作目录写允许）。stdio 取消 51ms、HTTP 取消 33ms；session/profile/worker 0。证据：`mcp-diagnostic.log`、`mcp-diagnostic2.log`、`mcp-final.log`、`b/mcp/results.json`。

诊断改动未修复执行行为，当前通过不能抹去旧异常，原因尚未确定；F 应绑定最终工件集中跨进程再验证及保留错误定位。本项为有条件通过。

### 7. 搭建与操作

#### 连续追问与停止

当前 Host 真 API 连续两轮 explain：首轮记录学生 8 岁，次轮沿用年龄并生成适龄比喻，没有返回 patch；真实模型 `deepseek-flash`，11210 输入 + 1782 输出 = 12992 Token。请求 ID `0f10a4bf-4463-41cb-98aa-dc86e0db2a5d`、`656549a5-0cdd-4880-8a29-0575af39629c`。证据：`chat/live-result.json`。组件覆盖停止迟到结果、项目隔离、候选状态及资源 flush 期间停止；不替代连续聊天布局和普通包原生交互。完整 A15 三作品、审阅/拒绝/接受/撤销/保存重开待 F。

## 错误汇报、风险与存储

- 冻结语料因 Windows CRLF 首轮执行前拒绝；主 Agent 用 `.gitattributes` 固定 byte checkout 后恢复原 SHA。语料和门槛未变。
- 生产判断 evaluator 初稿缺 `judgmentReceipts` 初始化，运行报 ReferenceError，未发 API；主 Agent 修复后实际重跑通过。不能以根 typecheck 替代 scripts 可执行性。
- MCP 两轮 OWNERSHIP 历史异常未归因，已限制结论；当前新工件复验通过不称“修复”。
- 检查未修改产品源码，未引入重复业务实现或临时产品补丁；合成探针只位于 `try/`。
- 工具默认系统 profile 位于 `C:\Users\29551\AppData\Local\Packages\Blocky.Tool.<随机UUID>`；实际解析 profile 为 `C:\Users\29551\AppData\Local\Packages\Blocky.Tool.75c75f78-b6d3-41b9-8512-b41dd1084421`（首轮取消）和后续 token 验证 profile，均实测删除。bundled Python 读取位置 `C:\Users\29551\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe`，以 `-B` 执行，测试 PDF 仅写入工作区。
- 临时资料当前约 88057226 字节，其中 `D:\1Folder\Blocky-AI\try\agent-capability-upgrade\windows-bc\b\mcp\bundle\node.exe` 为 86989128 字节可重生成副本。自动审批策略拒绝已结算 bundle 清理，返回 `blocked by policy`，未提供更具体原因；未绕过删除。由主 Agent 后续按项目规则整理待清理目录；其余结构化回执保留供 F 引用。

**真实大模型 API 调用：是。** 本次自主工具、连续聊天和质量判断三项分别为 2099、12992、150571，合计 **165662 Token**；无秘密请求 ID/逐条用量见上述证据。本地嵌入、神经重排、解析/OCR均未真实调用外部大模型 API。
