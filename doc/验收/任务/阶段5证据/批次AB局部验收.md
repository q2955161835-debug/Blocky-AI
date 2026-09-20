# 阶段 5 批次 A/B 构建助手局部独立验收

验收时间：2026-09-20 16:23 ~ 2026-09-20 16:42（Asia/Shanghai）
验收 Agent：builder_stage_review（未参与本轮产品实现）
验收范围：`packages/builder-protocol/`、`packages/builder-engine/`、`apps/studio-host/src/builder/`、`provider/builder.rs`、`provider/builder_tests.rs`、`process_job.rs` 的直接影响；不包含正在实现的应用界面新路径，不作阶段 5 最终验收。
源码状态：`codex/feat-stage5-builder-surfaces` 未提交工作区快照；本结论只绑定本次读回，不能代替冻结提交后的复验。

## 汇总表格

| 用户功能 | 场景 | 结果 | 关键证据 |
|---|---|---|---|
| S5-06 使用真实构建引擎（本地部分） | 固定 Pi SDK sidecar、确定性运行、依赖与来源核对 | 通过 | `@earendil-works/pi-agent-core` / `pi-ai` 0.86.0 锁定；npm 注册表读回 MIT、同一 gitHead；真实 sidecar 返回 `pi-agent-core/0.86.0`、`modelApiCalled=false` |
| S5-07 限制助手工具权限 | 四工具、目标/选择/repair 范围、未知工具与坏消息、密钥隔离 | 通过 | 固定 `inspect/draft/patch/verify`；Host/协议双层范围校验；bundle 审计 forbidden=0、builtins=0；请求、项目和资源注册表在 sidecar 前执行凭据形状拒绝 |
| S5-08 停止构建与回收引擎（局部） | 四轮预算、进行中取消、Job Object 结算与后代进程回收 | 通过 | 独立预算探针 4 轮后稳定拒绝；独立 Host 探针返回 `BLK-BUILDER-CANCELLED` 且 shutdown 成功；真实后代进程 Job 测试通过 |
| 请求/工具消息验证 | 请求字段、响应 tool call、顺序、重复 ID、未知工具和畸形参数 | 通过 | 相关 TS/Rust 测试通过；Host 只注入四个函数定义，禁用并行工具调用 |

局部结论：**通过**。验收过程中首次发现未带标签的常见 Provider key 形状可通过 TS 与 Host；实现 Agent 增加九类共享规则及双门禁后，原独立失败探针转为通过。该修复已在本轮局部范围复验。应用界面、真实 Provider 响应、完整 Host 超时/崩溃夹具、普通发行包与 Full 均不在本结论中。

真实大模型 API 调用：**否**。本轮未调用 DeepSeek 或其他外部大模型 API；npm 元数据查询只用于依赖来源核对，不是模型调用。

## 详细报告

### 用户功能：使用固定构建引擎

#### 场景：固定 Pi SDK 与 sidecar 边界

- `package.json` 与 `pnpm-lock.yaml` 将 `@earendil-works/pi-agent-core`、`@earendil-works/pi-ai` 固定为 0.86.0，并锁定完整性摘要。npm 注册表读回两包均来自 `https://github.com/earendil-works/pi.git`、许可证 MIT、gitHead `ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc`。
- `pnpm build:builder` 退出 0；生成审计读回 retained=646、builtins=0、forbidden=0。`builder.mjs` 为 570886 字节，SHA-256 `d5d4580f2cccc6d7f884523719ab76b131b67bb20f4fab137bdc096f0b4d56b1`；Node 22.23.1 为 86989128 字节，SHA-256 `f8d162c0641dcee512132f3bcf8a68169c7ecb852efd8e1a46c9fec5a0f469ed`。
- Host 在启动前逐字核对 runtime manifest、文件字节数与 SHA-256；sidecar 使用 `--permission --no-addons`，只允许读取锁定的 `builder.mjs`，清空环境后仅补入 `SystemRoot`，工作目录固定为 runtime 目录。
- `real_sidecar_is_read_only_and_reaped_before_completion` 新构建后重跑通过；结果明确为 Pi 0.86.0 且未调用模型 API。

结论：通过。最终发行仍需把 Pi MIT/来源纳入发行许可证与成品清单，本报告不替代批次 F 许可证覆盖验收。

### 用户功能：限制助手权限与敏感输入

#### 场景：四工具及作用域

- Pi Agent 只注册 `inspect`、`draft`、`patch`、`verify`；bundle 审计未保留 Provider、Harness、Shell 或网络 built-in。
- `inspect` 返回模块、选择、目录、诊断和资源名称投影；`draft` 生成 Build Spec；`patch` 只生成候选；`verify` 只编译候选。解释不允许补丁，repair 限定选中或诊断定位积木，目标模块与页面意图由请求绑定。
- Provider 响应只接受固定四工具、对象参数、唯一且受限的 call ID；Host 校验消息角色、工具调用与结果配对、消息数量/总量及未知字段，且发送 `parallel_tool_calls=false`。

#### 场景：凭据不进入 sidecar

- 首轮独立探针发现缺陷：未带 `api_key=` 标签的 `sk-...` 形状在 TS `parseBuilderRequest` 与 Rust `BuilderStart::validate` 均被接受。该输入会随 request 进入 sidecar，违反本轮密钥边界。
- 修复后 TS/Host 共用九类规则，覆盖 Bearer/带标签凭据、`sk-`、GitHub、AWS、Slack、私钥头和 JWT。Host 在 sidecar 启动前检查 prompt、完整项目字符串值和资源注册表；真实秘密值仍只在 Host `SecretStore::with_secret` 闭包内交给 HTTPS transport，不进入 sidecar IPC 或环境。
- 原独立 TS 探针由 1 通过/1 失败转为 2/2 通过；Rust 探针由 `hostAcceptedSecretShape=true` 转为 `false`；Host 新增 `rejects_credentials_before_sidecar` 后 builder 相关 5/5 通过。

结论：通过。敏感规则是明确类型集合，不能外推为任意未知秘密检测器。

### 用户功能：停止构建与回收引擎

#### 场景：预算、取消和进程树结算

- 独立 TS 探针使用本地 fixture 连续只调用 inspect；第 5 轮前稳定返回 `BLK-BUILDER-BUDGET`，生成函数实际调用 4 次，没有外部请求。
- 独立 Rust 探针在真实 Host run 进行中调用 cancel，读回 `BLK-BUILDER-CANCELLED`，随后 `shutdown()` 成功。
- builder sidecar 在 Windows Job Object 中启动；无论完成或错误均执行 Job settle、child wait 与 reader join。共享 `process_job` 的真实后代进程测试读回后代句柄从活跃变为已终止，1/1 通过。
- Host 同时限制一个 active request、拒绝 requestId 重用；IPC 绑定 schemaVersion/requestId/顺序 turn，单帧 2 MiB、会话输出 8 MiB、最多 128 帧、最多 4 个 Provider turn，总生命周期 120 秒。

结论：通过本轮指定的取消、预算与进程结算范围。120 秒超时、sidecar 崩溃与坏 runtime 的专门动态夹具尚未执行，留在后续 Host/最终验收，不由本局部结论覆盖。

## 验证命令与结果

| 命令 | 结果 |
|---|---|
| `pnpm exec vitest run packages/builder-protocol packages/builder-engine packages/language-schema` | 退出 0；5 文件、18 测试通过 |
| `cargo test --manifest-path apps/studio-host/Cargo.toml --lib builder -- --nocapture` | 退出 0；builder/provider 5/5 通过 |
| `pnpm exec vitest run --config try/stage5/acceptance-ab/vitest.config.ts` | 修复前 1/2；修复后退出 0，2/2 通过 |
| `cargo run --manifest-path try/stage5/acceptance-ab/Cargo.toml --bin host-secret-shape` | 修复前 accepted=true；修复后退出 0、accepted=false |
| `cargo run --manifest-path try/stage5/acceptance-ab/Cargo.toml --bin stage5-builder-acceptance-probe` | 退出 0；`cancelled=true shutdown=true` |
| `cargo test --manifest-path apps/studio-host/Cargo.toml --lib job_settles_a_real_descendant_before_output_reader_finishes -- --nocapture` | 退出 0；1/1 通过 |
| `pnpm build:builder` | 退出 0；builtins=0、forbidden=0，runtime hash 已读回 |

## 产物与边界

- 独立探针源码：`try/stage5/acceptance-ab/`，现为 155458 字节。其单独 Cargo target 曾为 3399180799 字节；直接删除被本机策略阻止后，已用 Windows 回收站方式移除并读回原路径不存在，可恢复。
- 工作区外读取/写入：读取 Codex 记忆与 skills；`npm view` 访问 npm 注册表；独立 Cargo probe 使用默认 `C:\Users\29551\.cargo\registry` 缓存，可能补充下载本机缺失 crate；上述 3399180799 字节 target 已移入 Windows 回收站。没有在工作区外写入业务数据。
- 未执行：真实大模型 API、应用界面新路径、桌面 GUI、CLI 成品、全盘 `pnpm check`、Core/Full、发行构建、许可证覆盖和最终验收。
