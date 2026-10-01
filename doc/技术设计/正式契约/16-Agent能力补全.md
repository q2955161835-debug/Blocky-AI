# Agent 能力补全：共享接口与实现边界

状态：2026-10-01 A、B/C 和 D 已完成独立阶段验证；E 的媒体共享链路已验证，触发器与评估修复待集中独立复验。整体范围、17 项验收与独立角色已确认；普通包与完整长稳 F 尚未交付。开发证据与正式结论以[任务验收](../../验收/任务/验收-2026-09-30-Agent能力完整补全.md)为准。

## 模型资源与请求

保留 `blocky.provider-request/v1` 的 DeepSeek/息壤固定端点。新增 `blocky.model-request/v2`，以 `projectId/resourceId/requestId` 引用本机用户模型资源；请求不携带端点、密钥或敏感请求头。文本、模型提出的工具调用及配对工具回执共用消息列表。工具只返回候选，执行由 Runtime/Host 的独立能力入口决定。

支持的生成适配器为 `deepseek-v1`、`xirang-v1`、`openai-compatible-v1`、`ollama-v1` 和 `managed-local-v1`。本批开放 text/tools/structured-output；嵌入、重排、图像与音频由后续对应批次实现，不以资源可声明代替适配器能力。

自定义兼容服务的 baseUrl、可选 apiKey/headers 进入 Host SecretStore。远程目标须为 HTTPS 公网域名；解析结果必须为公网地址并绑定到连接，拒绝重定向和环境代理。Ollama 是独立 loopback HTTP 配置，只允许明确的 `127.0.0.1`/`::1` 地址和端口。请求审批摘要绑定完整资源、请求与同次读取的密文版本；批准后修改目标、模型或秘密配置会使旧摘要失效。

DNS 共用原知识来源网络策略。当系统仅返回基准测试网段的合成地址时，使用固定 TLS 公共解析器重新查询并校验名称/CNAME、公网地址；不会直接连接合成地址。覆盖 IPv4 `198.18.0.0/15` 与 IPv6 `2001:2::/48`，后者范围依据 [IANA 注册表](https://www.iana.org/assignments/iana-ipv6-special-registry)。其他私网、回环、链路本地等结果仍拒绝。

v2 响应包含实际 model/requestId、finishReason、text/toolCalls 和 usageStatus。供应商未报告用量时 `usage=null, usageStatus=unavailable`；缺字段或不一致的部分用量不补零。未知工具、重复调用 ID、未结算工具历史、截断结束和超限响应拒绝。结构化输出使用有界 JSON Schema 子集，并在 Host 校验实际返回值；JSON 属性名支持大小写及 Unicode，与积木稳定 ID 分开验证。

## 本机托管模型

初始工件为 Qwen3 0.6B Q8，模型 ID `qwen3-0.6b-q8-v1`。模型 revision、大小、SHA256、llama.cpp b11146 及 CPU/Vulkan 运行库逐文件清单固定于 `apps/studio-host/src/local_models/artifact-lock.json`。模型与运行库按需下载或从用户选择文件导入，普通软件包不预装权重。

选定资料根中的 `managed-models/<modelId>/` 保存模型、精确运行库白名单、清单与许可证。临时安装目录在同一根内，大小/哈希校验完成才原子发布。安装、推理和卸载共用文件锁。卸载只处理清单内已知文件，拒绝额外文件和链接；已知文件部分缺失时支持继续卸载。

推理使用带随机临时认证的 loopback llama-server。进程在暂停状态加入 Windows Job 后启动，仅传入必要环境；读取的模型与运行库保持禁止写入/删除的文件句柄。预算覆盖上下文、线程、进程内存、请求截止时间；Vulkan 必须指定设备。每次请求结束、失败或取消后终止 Job、等待进程、关闭端口并回收输出读取线程。当前不保持后台常驻模型；忙碌时状态不把 loaded 伪报为 false。进程内存限制不等同驱动级显存硬上限。

共享 CLI 为 `model catalog/status/install/verify/remove/cleanup/preflight/generate`，通过 `commands` 和 `schema` 发现请求结构及恢复入口。下载必须显式 `--download`，本地导入须同时给出模型和运行库文件。桌面导入由 Host 原生选择文件，WebView 不接触文件路径；安装/卸载/临时工件清理在 Host 显示操作确认，验证和安装可取消。

CLI 安装使用独立的单次行协议。取消或 stdin 断开通知安装器回收临时目录，客户端等待进程退出后才确认取消；5 秒仍未退出则强制停止并报告中断，要求查询状态。安装开始即写入精确归属清单，`status` 显示未完成安装数量和已识别字节数；`cleanup` 在共用锁内先检查全部目录，只删除已知清单和白名单文件，未知文件、链接和旧版无清单现场一律保留。

## 构建助手接入

构建助手保持 inspect/draft/patch/verify 固定语义工具、项目摘要和候选审查流程。新模型走同一 v2 网关；解释意图只提供 inspect/draft，并要求 explanation。模型所见的可执行工具随授权意图缩小，拒绝把普通文本当作已完成候选。

本地推理的响应证据明确标记 local；外部 API 调用根据 remote 传输事实记录。引擎内部 SDK 的用量占位值不进入实际响应证据；生成记录保留 reported/unavailable 和原始有效用量。

右侧构建助手采用消息区与底部输入区。`builder-request/v1` 增加可选 conversation，最多 20 条、每条 4000 字符、合计 32000 字符，包含 user/assistant 正文及候选状态；CLI 用 `--conversation <messages.json>` 提供同一字段。每轮传入当前项目摘要，旧方案状态不授予权限，只有当前候选可审阅和接受。解释操作必须直接回答当前问题，不能用后续计划代替答案。

对话保存到当前资料根 `user/builder-chat/<projectId>.json`，不写入作品、蓝图或补丁。记录最多 40 条、正文合计 64000 字符，并受全包输入字节预算限制；Host 拒绝凭据文本、未知字段、跨项目 ID 和候选载荷。重开只恢复对话，未应用候选标记需重新生成；切换项目隔离历史并取消旧请求。停止、退出和取消状态等原生请求结算后才结束，退出还须刷新本机对话。

## 参考与边界

工具调用参考 [Qwen 官方说明](https://github.com/QwenLM/Qwen3/blob/main/docs/source/framework/function_call.md)及 [llama.cpp 的 required 工具选择讨论](https://github.com/ggml-org/llama.cpp/issues/27217)。特定上游版本/模型的问题不能直接外推到当前锁定工件；本项目仍验证实际响应结构，不把服务端宣称支持当作调用成功。

知识/OCR、多模型索引、记忆、技能、协作、学习式决策和媒体已经接入共享领域；当前阶段结论绑定各自源码和证据，不外推为普通包交付。

## 工具循环、控制流与 MCP

`core.reason.tool_loop` 将公开工具声明、模型调用与回执交给同一 AgentServices。每轮携带实际历史，校验工具名、调用 ID、输入和输出 Schema；模型最终文本才结束循环。调用次数、步数、Token 和截止时间共享 RunBudget，项目工具调用继续共享总预算并隔离模块局部状态。foreach、while、try 和 retry 保留有界执行；结果未知或含副作用的失败不得自动重试。模型响应元数据不保存工具参数正文。

Host `blocky.tool-request/v2` 只接受本机资源引用和业务输入。`http-json`、`search-json`、`mcp-tool` 与 `mcp-server` 在 Host 解析登记端点、秘密及进程工件；审批绑定请求、配置、秘密版本和 bundle 哈希。模型无法提供端点或启动命令。工具资源引用时复制公开 Schema 到项目，遇到同名不同内容拒绝覆盖。Runtime 的默认能力集合限于已有类型化能力；显式运行限制继续收窄，实际执行仍须通过 Host 资源权限与审批。

每次副作用前写入仅含引用、摘要和状态的持久回执。请求 ID 不可重放。stdio 的可信启动边界在暂停进程恢复前设定：边界前明确失败记录 failed，允许新的请求 ID；跨越边界后的取消、进程消失或输出不符合 Schema 保守标记 unknown，同资源的新请求被阻止。HTTP 发出请求前同样进入可能产生副作用状态。未结算请求和旧格式 unknown 不自动降级。用户核验实际目标后可提交摘要绑定的 confirmed-completed 或 confirmed-not-applied 结算，恢复不会自动重发原动作。CLI 和桌面提供预检、调用、状态、结算及临时工件清理；停止和运行结束等待原生请求实际结算。

MCP 支持 stdio 和 Streamable HTTP 的初始化、分页工具/资源发现、工具调用和文本资源读取。HTTP 接受有界 JSON/SSE，限制目标、会话、响应大小及截止时间；不处理服务端反向采样、文件系统或 Shell 请求。stdio 使用 AppContainer、独立 Job、精简环境及只读复制 bundle；只允许写入本次工作目录，默认无网络。Node 工具额外使用权限参数；原生进程也受系统边界约束。未完成 bundle 有精确归属清单，清理遇到活动锁、未知文件或链接时停止。系统会临时建立 Windows AppContainer 资料，结束后删除并读回。

CLI 安装和工具调用共用协作取消传输，stdin 关闭同样取消。强制中断返回明确错误及查询/清理路径。工具办事助手起点使用真实具备 tools 能力的模型；未选模型时给出配置诊断，本地模拟资源不伪装成可自主调用工具的模型。

## 记忆、技能、协作与决策

记忆请求使用 `blocky.memory-request/v1`，由 Host 按项目和会话授权、版本比较后写入。会话、项目和来源索引遵循各自保留范围；来源删除或版本失效后，读取及模型上下文不得复用旧内容。作品仅保存引用。CLI 提供 `memory preflight/execute`，变更绑定实际请求摘要与 expectedVersion。

技能包经准备、清单和摘要核验后安装到所选资料根，发布后按不可变版本使用；执行仍由 Host 能力控制，不获得用户终端或任意 Shell。多 Agent 顺序与并行委派共享父级步数、调用、Token 和期限预算，子任务能力只可收窄；作用域和输出独立，实际模型请求 ID 不重复。学习式决策保存有界候选、评分和版本，模型评分走正常网关，不以人工或确定性分数冒充真实模型评判。

## 触发器与外部事件

配置 `blocky.trigger/v1` 绑定 project/module/export 和递增修订。目标必须为可编译的持久工作流入口。定时支持一次或 1 秒至 1 年的间隔；startsAt 为 UTC 毫秒，timeZone 只支持 UTC 或不超过 ±14:00 的固定偏移，不提供 IANA/DST 换算。错过事件策略为 skip 或 latest，不补发无界历史。

Host 在执行前以 occurrenceId 原子登记 claimed；只有同项目、同模块的实际持久工作流终态可以结算。取消、等待审批、结果未知或配置变化时保留 claimed 和恢复信息，重开不自动重放。一个新接收批次中的尚未启动兄弟事件可依次处理，历史 claimed 不能借此绕过恢复门禁。

外部接收器仅监听本机 loopback 随机端口 `/events`，Bearer 从 Host SecretStore 引用读取。事件 `blocky.external-trigger-event/v1` 校验项目、来源、修订、时间窗和有界 JSON；重复 eventId 不入队。负载只存于有界内存，不写入回执或日志。暂停、撤销授权、取消、stdin 断开或退出会关闭接收器并等待线程和端口回收。桌面资源面板及 CLI `trigger create/list/pause/run/watch/listen` 复用同一 Host 与 Runtime；监听本身不授予运行权限。

## 媒体与来源绑定

图片和音频从原生选择器或 CLI 显式导入，WebView 只获取 mediaId、SHA256、版本等引用。支持验证后的 PNG/JPEG 与单声道 16 kHz PCM16 WAV；单文件最多 8 MiB，项目总量 64 MiB、最多 128 项，音频最长 120 秒。媒体加密保存，当前按用户手动删除保留，不承诺自动过期。预览授权随项目和组件生命周期回收。

图片理解通过正常模型网关，用户消息最多 4 张授权图片；Host 读取和校验后构造供应商输入，模型不能提供任意路径或 URL。生成前后、输出和记忆读写再次核对来源；删除、版本不符或取消会使相关缓存和检查点结果失效。图像能力与真实支持图片的资源绑定，纯文本响应不能证明图片理解。

语音转写使用固定 whisper.cpp CPU 运行库与多语言 tiny 权重；发布清单包含逐文件哈希、版本和许可证。进程在 AppContainer 和 Job 内运行，取消后等待进程退出。返回文字经同一来源绑定进入输出或记忆。该转写为本地模型，不属于外部大模型 API 调用。

## 评估工作台

数据集、报告和检查点分别使用 `blocky.evaluation-dataset/report/checkpoint/v1`，按项目保存，使用版本比较和原子发布。冻结版本不可覆盖；调整项目或模型配置后须 fork 新版本。模型 version 为配置摘要，不能解释为供应商权重版本。报告比较要求相同评估语料，保留各版本绑定和可用的实际用量。

每个案例通过当前项目编译入口和独立 Runtime 执行，模型、工具和权限继续走正常网关。批次取消先等待正在执行的案例结算，再以独立资产生命周期保存部分报告和检查点；未知副作用不得自动重试。恢复核对冻结数据集、候选和配置绑定。默认 summary 报告不保存回答正文；显式 structured 只保存经结构化脱敏的业务结果。Host 对每层声明元数据执行严格字段、状态、计数、用量及摘要校验；数据集业务 input/expected 保留为合法 JSON。

桌面评估工作台与 CLI `evaluation create/import/freeze/fork/run/list/read/compare` 使用相同存储。CLI `schema list/show` 公开当前实际校验器，包括触发器、外部事件及评估检查点。检查和开发阶段通过不代替普通包、设置盘点、完整 Core/Full 与最终独立验收。
