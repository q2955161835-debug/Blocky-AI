你的当前画布（模块 `main`，显示名“主画布”）共 8 个积木，构成一条**单链顺序执行**流程。起始是 1 个根积木，下面按 `next` 依次串联 7 个。

执行顺序如下：

1. **core.agent**（`assistant-root`）
   - ROLE：设定助手身份——“刑事法条学习问答助手”，只基于 `assistant-knowledge` 资料（仅覆盖《刑法》第 133 条与第 133 条之一）回答，须引用原文并区分“交通肇事罪”（第133条）与“危险驾驶罪”（第133条之一），只做条文学习与对比，不推断/评判具体案件。

2. **core.interaction.chat**（`assistant-chat-trigger`）
   - NAME：资料问答。作为对话触发入口。

3. **core.prompt.context**（`assistant-evidence-instructions`）
   - TEXT：注入约束——回答前必须先检索 `assistant-knowledge` 并通过证据护栏，只依据命中的条文原文作答；引用须标明来自第 133 条还是第 133 条之一，清楚区分两罪名构成差异；资料未命中或超出覆盖范围时如实说明边界，不编造、不推断。

4. **core.run.budget**（`assistant-run-budget`）
   - 运行预算：CALLS=256，OUTPUT_TOKENS=1048576，STEPS=10000，TIMEOUT_MS=1800000。

5. **core.knowledge.retrieve**（`assistant-knowledge-retrieve`）
   - RESOURCE：`assistant-knowledge`。检索知识资料。

6. **core.guardrail.evidence**（`assistant-evidence-guardrail`）
   - POLICY：`require`。要求答案必须有资料证据支撑。

7. **core.model.compose**（`assistant-compose-answer`）
   - RESOURCE：`xirang-personal`。调用模型生成答案。

8. **core.output.answer**（`assistant-answer`）
   - STYLE：段落。以段落形式输出最终回答。

整条链的逻辑是：**设定刑事法条学习助手角色 → 用户聊天触发 → 注入“先检索+证据护栏”的约束 → 设定运行预算 → 检索 `assistant-knowledge` → 证据强制校验 → 模型组织答案 → 输出段落回答**。当前无诊断错误，未做任何修改。