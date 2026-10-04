# POC 与演示视频

此目录保留初赛 POC（概念验证）与录屏剧本，作为历史参赛资料。2026-10-04按用户要求从根目录 `POC与演示视频/` 移入本目录，作品及剧本内容保持原值；本目录当前没有视频文件。

## 自然科学课程助教 Agent

- 可打开项目：`Blocky-自然科学课程助教-Agent.blocky`
- 录屏剧本：`Blocky-自然科学课程助教-Agent-60秒录屏剧本.md`
- 项目格式：`blocky.document/v1`，内含 `blocky.spike-project/v1` 项目快照
- 项目 SHA-256：`ba52d6eaaf18b6693702eb4c6226a003e5a6d260462f206d4160f8f5fd9e20de`

这是阶段 1 之前的真实模型技术 POC。Agent 本身定义一条可复用的 17 积木工作链：同一聊天入口声明文本、图片、文件、语音四种输入，暴露课程资料分析 Skill 与学习卡片插件动作；文本演示随后执行拆解子任务 → 检索课程库 → 证据重排去重 → 调用 DeepSeek 合成 → 逐条事实核验 → 绑定课程引用 → Markdown 排版 → 创建并回复消息。项目中没有保存固定答案、API Key 或单题判断。普通 Windows release 通过 Rust Host 调用 DeepSeek Chat Completions，界面在成功后显示实际模型、请求 ID 与 Token 用量；WDIO 和自动化测试仍使用隔离的确定性适配器，不产生外部消费。当前课程知识仍是小学自然科学本地夹具，用于稳定证明秋叶、水循环、光合作用和资料缺失等不同输入会走同一条证据链；它不代表生产级外部知识库连接器或完整 RAG 已完成。

真实大模型 API 调用：**是**。2026-08-26 的普通 release 复验由 DeepSeek 返回实际模型 `deepseek-v4-flash`，输入 514 Token、输出 309 Token、总计 823 Token；密钥只保存在 Git 忽略的本地 `.env`，不进入项目文档或 `.blocky`。
