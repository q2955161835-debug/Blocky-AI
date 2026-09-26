# CLI 受控 Runtime 局部复核

- 等级：L3；独立 Agent：diagnostic_scope_review，未参与实现。
- 初始固定来源：`3e0c86c6264669b5fb610d77e612201126c11374`，相对 `800791d`；实施检查点 `4687258`。
- 最新握手修复来源：`d2ff18dfa27651f5a12dbad43d9e11fc103b6ffc`；新工件独立复验于 2026-09-26 22:19 ~ 2026-09-26 22:20 完成。
- 范围：原生 managed/wire/assets、Execution 共享 worker、环境白名单、公开 CLI run start 的受控启动/审批/取消及构建扫描打包直接接线。桌面 Runtime 未迁入。
- 真实大模型 API 调用：否。全部运行使用合成项目及 simulate，没有 GUI、Full 或可见浏览器。

## 汇总表格

| 用户功能 / 场景 | 结果 | 证据 |
|---|---|---|
| CLI 运行 / 真实固定 Node worker 与环境隔离 | 通过 | 初始冻结工件真实原生测试；NODE_OPTIONS 注入未生效，取消后 worker 已退出 |
| CLI 工具批准 / 明确允许和拒绝 | 通过 | 公开 CLI simulate 交互各 1 项，摘要批准保留原 Runtime 权限流程 |
| CLI 停止 / 超时、失联及未知效果 | 通过 | 初始模拟通道 3 项与真实取消；成功须 done 且 supervisor 退出 |
| 工作流账本 / 多任务归属及 EOF | 通过 | 新来源真实 CLI 连续两个任务及终态重开；active EOF 后保留 executing 并拒绝重新接管 |
| 私有协议 / 显式版本拒绝 | 通过 | 新来源原生缺失/未知版本 2/2 拒绝；worker 端严格检查静态核对 |
| 普通包 / 桌面迁入及完整恢复 | 未执行 | 本批不包含 GUI/Full、普通包或未知效果人工解决 |

## 详细报告

### 1. CLI 运行：固定启动与两道门禁

静态追踪公开 `main` 的 run start 进入 managedRun；原生 helper 根据内嵌 worker hash 和既有 builder Node 锁校验固定资产，使用挂起创建、HANDLE_LIST 私有管道和无 breakaway 的 Job，然后允许固定 bootstrap 启动。worker 只接受 run start 并复用 dispatch/runAgent/Runtime。任意可执行路径没有进入前端帧。

环境只保留明确 OS/路径/profile 项，NODE_OPTIONS/NODE_PATH 与秘密配置不继承至 Node；真实无效 NODE_OPTIONS 用例仍能开始并取消。测试不证明同一用户任意本机代码的对抗隔离，也没有借用真实秘密。

业务工作流 open 在返回成功前获取 lease 并持久绑定 task view。共享 Arc Worker 允许连续输入的任务分开持有 task/lease 绑定；完成通道 close 仅清除当前协议任务，不提前释放 lease。真正 worker stop 后才逐任务写入匹配停止凭据，无 active 才 release。有 active 的业务结果不会因本地进程停止而成为已完成或允许重放。

### 2. CLI 审批、取消与传输

固定 worker 的交互工具审批通过私有 id 往返到原 CLI，用户必须输入完整摘要，默认其他输入拒绝。原生只接收当前 pending approval 的布尔答复；取消会拒绝待批请求并限制后续推进，仅允许 complete/uncertain/pause/close 收尾。

私有 Rust 帧最大 20 MiB、队列有界、写回等待 5 秒，读帧数量有上限。Node 请求等待有界；CLI 总等待 325 秒，取消失败 12 秒后终止并返回“停止请求未确认”，不冒充结算。收到 done 仍须 supervisor 实际退出才成功。正常、EOF、错误和超时走共享真实 worker stop，再处理任务持久停止凭据；任一失败保留不确定性。

错误码使用固定公开集合，任意错误形正文不会直接返回。实际模拟负例覆盖假错误码、永不 close 的取消和 done 后未退出不得成功。本轮没有实际大帧持续背压或 325 秒实时间等待，相关上限为静态和模拟验证。

### 3. 资产与交付边界

worker 字节数/hash 编译进 Host；Node hash 复用 builder runtime lock。构建先生成 worker 与锁再编译 Host，扫描增加 worker，打包放入 cli/runtime-worker.mjs。原生查找路径分别覆盖开发 cli/bin/builder 和普通包 builder 位置；release 不启用源码目录 fallback。本轮未生成或运行普通包，不把这些静态接线当作普通包验证。

### 4. 初始来源实际运行

命令：`pnpm exec vitest run tests/cli/runtime-managed-native.test.ts tests/cli/runtime-managed.test.ts --maxWorkers=1 --reporter=verbose`。

- 2026-09-26 22:12 ~ 22:13：6/6，通过，退出 0；3 项实际原生 CLI/worker，3 项模拟传输。
- 日志：`try/stage7/workflow-managed-review/cli.log`；hash 读回：`artifacts.log`。
- helper SHA256：`1d1bae88189d0b400b4284ff2799a1d71ef226e314e3f7e0271ea8dfc83f615a`。
- CLI main SHA256：`5fdaae2025cac7149dba49cddf6d63ee11080556f3bf73863311e6ca02d9c2d0`。
- worker SHA256：`522589f3ea41a0d5deeaaa77f9d1c4e245ca7487876c4205ee6a813f69c29854`。

运行开始后主方通知将补充显式协议版本，以上测试自然退出后已暂停 CLI 工件执行；不能把本节旧来源运行当作后续修复的新结果。

### 5. 新来源握手与直接影响复验

`d2ff18dfa27651f5a12dbad43d9e11fc103b6ffc` 增加初始 `schemaVersion=blocky.runtime-session/v1`：原生在解析 argv 和启动资产前检查版本，worker 也在 dispatch 前严格检查；后续帧沿用已建立版本。旧来源缺口保留为历史，不再作为当前未关闭问题。

实际命令：

1. `node node_modules/tsx/dist/cli.mjs try/stage7/workflow-managed-review/probe.ts`：退出 0，两个独立真实场景通过。修改合成普通工作流移除等待审批后，公开 CLI 连续两输入生成两个 completed 任务，查询均可见，终态恢复可重新取得 lease。另一个合成工作流在 active 的等待积木启动后关闭 helper stdin，返回 CHANNEL；任务仍 executing，后续公开 CLI 恢复 exit 3，未重放未知效果。
2. `pnpm exec vitest run tests/cli/runtime-managed-native.test.ts -t 'handshake version' --maxWorkers=1 --reporter=verbose`：2/2，通过，3 项未选，退出 0；缺失及未知版本返回 INVALID，未派发运行。

日志为同目录 `probe.log`、`version.log`；`fixed-artifacts.log` 确认新工件：

| 工件 | 字节数 | SHA256 |
|---|---:|---|
| helper | 52,280,320 | `3f915daf1b442db18c6901d82cb957fa59d549d89441f2493541aa81e8c26df9` |
| CLI main | 1,685,209 | `9da5a4fcc97f258151ce74a081dc6b0a97e5f6dd6a583f94e89257de5d469a70` |
| worker | 1,682,571 | `ef771ae971c5330fef82e38f39b0889d328035ff3c4786f30017e3e069b0c1de` |

新来源不重复旧 6 项整批测试；正常 start、共享 custody 与 EOF 直接影响由新独立探针覆盖。TEMP/TMP 置于工作区 try；正式测试临时项目自行回收，独立合成项目/资料保留在同目录 probe-* 中，供复核，不包含真实秘密。没有 Cargo 编译。

## 问题与风险

初始来源的私有 start 帧没有显式协议版本，主方在复核期间主动发现并补修，最新来源已定向关闭。其余已审范围未发现确定需修缺陷。完全监督本地进程树不等于远端业务效果结算；桌面迁入、人工 resolve、普通包与完整阶段验收仍未交付或未执行。持续大帧背压、系统 API 故障注入与完整最长时限实时间压力未执行。

## 最终结论

通过。

仅覆盖本批公开 CLI 受控 Runtime 与本报告直接影响。旧来源测试和新来源复验分别绑定，不构成普通包、桌面迁入或完整业务恢复通过；阶段最终仍为未执行。真实大模型 API 调用：否。
