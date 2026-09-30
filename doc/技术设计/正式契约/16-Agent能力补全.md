# Agent 能力补全：共享接口与实现边界

状态：2026-09-30 批次 A 开发中。整体范围、17 项验收与独立角色已确认；后续 B–F 尚未交付。开发证据与正式结论以[任务验收](../../验收/任务/验收-2026-09-30-Agent能力完整补全.md)为准。

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

共享 CLI 为 `model catalog/status/install/verify/remove/preflight/generate`，通过 `commands` 和 `schema` 发现请求结构及恢复入口。下载必须显式 `--download`，本地导入须同时给出模型和运行库文件。桌面导入由 Host 原生选择文件，WebView 不接触文件路径；安装/卸载在 Host 显示操作确认，验证和安装可取消。

## 构建助手接入

构建助手保持 inspect/draft/patch/verify 固定语义工具、项目摘要和候选审查流程。新模型走同一 v2 网关；解释意图只提供 inspect/draft，并要求 explanation。模型所见的可执行工具随授权意图缩小，拒绝把普通文本当作已完成候选。

本地推理的响应证据明确标记 local；外部 API 调用根据 remote 传输事实记录。引擎内部 SDK 的用量占位值不进入实际响应证据；生成记录保留 reported/unavailable 和原始有效用量。

## 参考与边界

工具调用参考 [Qwen 官方说明](https://github.com/QwenLM/Qwen3/blob/main/docs/source/framework/function_call.md)及 [llama.cpp 的 required 工具选择讨论](https://github.com/ggml-org/llama.cpp/issues/27217)。特定上游版本/模型的问题不能直接外推到当前锁定工件；本项目仍验证实际响应结构，不把服务端宣称支持当作调用成功。

工具循环、MCP、知识/OCR、多模型索引、长期记忆、多 Agent、学习式决策、事件、多模态及评估工作台仍在本轮后续批次内。本文随实现更新，未实现能力不作为可用命令或普通包功能。
