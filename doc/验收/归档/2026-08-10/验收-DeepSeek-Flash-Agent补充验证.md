# 验收：DeepSeek Flash Agent 补充验证

## 汇总

| 项目 | 内容 |
|---|---|
| 涉及模块 | 外部模型兼容性、Tool 调用续轮、稳定 IR、RuntimeEvent、HostBridge 冻结契约、项目规则、主线整合与秘密边界 |
| 验收对象 | `main` / `7982639ef2b147444f65a59cca3b5b8c30f4c824`；核心契约代码提交 `642f06cb59420031925c47ee801505656e50ccf8` |
| 验收等级 | L3（外部凭据、网络请求、核心运行契约与工具边界） |
| 验证结果 | 冻结契约后 4 个限定 live 请求全部 HTTP 200；真实模型固定文本、工具两轮、运行事件、IR 形状、普通包隔离、安全差异扫描、项目规则与 `main` 合并后 Fast（快速）门禁全部通过；独立复审 Critical（严重）0 / Important（重要）0 / Minor（次要）0 |
| 问题风险 | 仅验证当前 API 与最小 seam（接缝）兼容；产品没有内置 DeepSeek 适配器；未验证 SLA（服务等级）、生产重试/限流/计费，也没有执行真实外部工具副作用 |
| 最终结论 | **通过** |

架构与总体边界见[Windows Core 技术尖峰报告](../../../技术设计/Windows-Core技术尖峰报告.md)，长期模块场景见[Blocky 编辑器与运行核心验收](../../模块/验收-Blocky编辑器与运行核心.md)。

## 详细报告

### 1. 授权、证据与秘密边界

验证步骤：

1. 只在用户明确授权后读取本地凭据文件，把值注入短生命周期测试子进程；不输出或复制真实值。
2. 临时 TypeScript 探针和定向缓存只放在工作区内已忽略目录；结束后删除并检查 Git 状态。
3. 报告只保留 HTTP 状态、耗时、Token（令牌）计数、布尔断言、提交/差异摘要与固定错误类别；不保留真实凭据路径、请求头、响应正文、模型正文或工具参数原值。

预期结果：凭据文件不被修改；秘密不进入 Git、日志、报告、截图或缓存；网络目标和请求数可审计。

结果：通过。当前有效复验只访问 `api.deepseek.com`，严格 4 个小请求；临时探针与缓存已删除，tracked（跟踪）工作树没有由 live 验收产生的修改。没有执行真实外部 Tool（工具），也没有把第一轮历史结果当成当前证据。

### 2. Live API 兼容性

当前有效复验时间为 `2026-08-10 16:38 ~ 16:41`（Asia/Shanghai）。Chat 请求按官方 [Chat Completion API](https://api-docs.deepseek.com/api/create-chat-completion) 显式设置非思考模式；工具消息链遵循官方 [Tool Calls 指南](https://api-docs.deepseek.com/guides/tool_calls)。

| 序号 | 目的 | HTTP | 耗时 | Token（输入/输出/总计） | 结果 |
|---:|---|---:|---:|---:|---|
| 1 | 模型列表与目标可用性 | 200 | 133 ms | 不适用 | 通过 |
| 2 | 固定文本与运行时注入 | 200 | 1162 ms | 23 / 13 / 36 | 通过 |
| 3 | 工具调用第一轮 | 200 | 76 ms | 338 / 40 / 378 | 通过 |
| 4 | 合成工具结果续轮 | 200 | 70 ms | 121 / 13 / 134 | 通过 |

历史首轮曾有一个固定 `TOOL_ROUND1_HTTP_ERROR` / HTTP 400：命名 `tool_choice` 与默认 thinking（思考）组合不兼容。探针没有读取或记录错误响应体；唯一协议修正是显式 `thinking.type=disabled`，随后重新建立冻结契约后的全新四请求证据。本表只采用后者。

### 3. IR、运行事件与 Tool 断言

验证步骤：把固定文本通过现有依赖注入 model seam（模型接缝）送入最小合法 `blocky.ir/v0-spike`；收集真实 `RuntimeEvent`；以本地合成工具结果完成第二轮消息。

预期结果：

- 每个 IR 节点显式包含必填 `fields`、`inputs`、`next`，不存在的链接为 `null`。
- 事件顺序为 `run.started -> block.started -> model.chunk -> block.completed -> run.completed`。
- 每个事件的 `eventVersion` 都是 `blocky.event/v0-spike`；序号连续、运行标识一致、带块事件命中 source map（来源映射）、终态唯一。
- 事件 `data` 为 JSON 对象记录，不能由公共工厂生成标量或数组。
- Tool 名称正确；参数是无额外字段的 JSON 对象；第二轮与第一轮 `tool_call_id` 一致；真实外部副作用为零。

结果：全部通过。模型原文和工具参数原值未写入本记录。

### 4. 冻结契约修复与本地门禁

独立整分支审查先发现：真实事件缺 `eventVersion`、IR 的 `fields` / `inputs` / `next` 被错误设为可选、事件 `data` 过宽，以及公开 `SaveProjectRequest` 与冻结 `{ projectId, json }` 形状重名漂移。修复以两个提交完成：

- `22f97782c73621d518ae68012f98f921959637d8`：恢复必填 IR 字段、显式 `null` 与真实事件版本，不再由 WDIO 测试钩子伪造版本。
- `642f06cb59420031925c47ee801505656e50ccf8`：限制事件 `data` 为对象记录，统一公开保存请求为 `{ projectId, json }` 并移除同义私有类型。

最终独立复审在 `642f06c` 从头执行：

| 命令或检查 | 结果 |
|---|---|
| 8 个聚焦文件 | 57/57 通过 |
| `pnpm check` | exit 0；unit 20 files / 97 tests、component 5 files / 33 tests、TypeScript/Vite、Rust 与仓库敏感扫描全部通过 |
| `pnpm check:core` | exit 0；原生 Core 1/1、性能 1/1、日志审计、普通 release 重建与隔离全部通过 |
| 普通 EXE | 11,779,584 bytes；SHA-256 `B7DA5DCBC7F98B86DD162B608AAAF761D700B5A756576FDD91A0D7290602BA98` |
| 普通包隔离 | `markers=0 cargo_wdio=0 capability=main` |
| Codex Security 差异扫描 | scan `2e5caaca-444b-4f26-91ed-bfb8b89f2c9b`；20/20；coverage complete；0 findings |
| Git | HEAD `642f06c`；tracked clean；`git diff --check` 通过 |

最终独立复审结论：PASS / merge-ready，Critical 0 / Important 0 / Minor 0；原冻结契约 Important 已关闭。

### 5. 不包含的产品结论

本验收不证明或授权：

- 在普通应用构建中加入 DeepSeek SDK、端点、密钥读取、模型选择器或持久化配置。
- 生产重试、配额、限流、账单、可用性、地域合规或模型长期不变。
- 调用真实天气、文件、网络、Shell 或其他外部工具。
- 把用户凭据复制到 `.env`、文档、日志或版本控制。
- 把一次外部兼容性探针扩大为完整 Agent 产品验收。

后续若实现正式模型适配器，必须创建新的 L3 任务验收，重新验证密钥真/假账本、网络/CSP、错误与取消、工具审批、日志脱敏、普通包隔离和发布构建。

### 6. 项目规则与主线整合

用户明确授权创建项目级 `AGENTS.md`、合并 `main` 并在验收后推送私有 GitHub（代码托管）。项目规则提交与修复如下：

- `f251235d1bb019c31479816e2c30e68163b911a6`：新增 Blocky 项目目标、长期文档入口、目录职责、架构数据流、依赖、命令、复测矩阵、安全边界、私有仓库地址和执行报告要求；同步 README（说明文档）与合并前风险记录。
- 首轮独立文档复审发现若干尖峰路径未带 `try/windows-core-spike/` 前缀，并把尚不存在的跨模块验收目录写成当前目录；结论为 Important 1、不可合并。
- `7982639ef2b147444f65a59cca3b5b8c30f4c824`：把所有尖峰路径统一为仓库根可解析路径，跨模块目录明确为按需创建。复审确认 30 个现存路径全部可达，Critical / Important / Minor 为 0 / 0 / 0，结论 merge-ready（可合并）。

主线整合步骤与结果：

1. 功能分支在 `7982639` fresh（新鲜）运行 `pnpm --dir .\try\windows-core-spike check`，exit 0：unit 20 files / 97 tests、component 5 files / 33 tests、TypeScript/Vite、Rust 2 + 23 tests 与四目标敏感扫描全部通过。
2. `main` 的唯一工作区修改是用户 Logo（标识）。先创建只含 `logo/logo.png` 的命名 Git stash（暂存栈），再从 `d98bc6c` fast-forward（快进）到 `7982639`。stash、HEAD 和磁盘 Logo 的 Git blob 均为 `10b4f0ae39fab54ff42d91973da77ebd1621088e`，SHA-256 均为 `12D3F351006663FD07EFD11480101F3C06A43F91633F2E8A914888CA63CF0D9D`；确认内容已被提交后删除冗余 stash。
3. 合并后首次 Fast 门禁在 `unit-tests` 入口失败：主工作区尚无项目本地 `node_modules`，固定错误为 `vitest not recognized`；代码测试尚未开始。两工作区 lockfile（锁文件）的原始字节因 Windows 换行转换不同，但经 Git 过滤后的 blob 均为 `e595635a4fb20136969e5e7c20203ee4cf63d9b3`，不存在依赖漂移。
4. 在 D 盘主项目执行 `pnpm --dir .\try\windows-core-spike install --frozen-lockfile --offline`，复用 540 个包、下载数 0、tracked（跟踪）工作树保持干净；随后从头重跑同一 Fast 门禁，exit 0，97 个单元、33 个组件、Rust 25 项、构建和敏感扫描全部通过。

合并后门禁失败由主工作区缺失忽略依赖造成，不是产品或测试失败；没有增加重试、放宽断言或修改锁文件。最终复审通过后，已注销并精确清理功能 worktree（工作树），删除已合并分支 `codex/feat-windows-core-spike`；当前只保留干净的 `main`。首次 push（推送）因 HTTP 408 未更新远端，经 `ls-remote` 只读确认后，以不 force（强制）、不 fetch（拉取）的普通幂等重试成功把私有 GitHub `origin/main` 更新到 `288e6a8d18075313bdcea2a0c00468aaa414b5eb`；未创建 PR（拉取请求）。
