# 验收：Windows Core 技术尖峰

## 汇总

| 项目 | 内容 |
|---|---|
| 涉及模块 | Blockly 编辑器、IR 编译器、交互投影、Tool 契约、确定性运行时、Tauri Host、Windows 原生 E2E、性能/长稳、安全扫描与普通构建隔离 |
| 验收对象 | `codex/feat-windows-core-spike` / `7eeb9a8e0974b4356e24abf80c3ade46d486af6e` |
| 验收等级 | L3（产品核心执行、权限与本地数据边界） |
| 验证结果 | ADR-001 八项 Core（核心）门禁、5 样本性能、360-cycle（循环）/30 分钟长稳、30 次 Host（宿主）保存重载、人工清单、敏感扫描与普通包隔离全部通过；最终独立复审 Critical（严重）0 / Important（重要）0 / Minor（次要）0 |
| 问题风险 | 这是一次性 31 块子集尖峰；非正式产品或完整 311 块实现；Vite（构建器）仍有大 chunk（代码块）警告；截图含少量无关桌面通知；第二、第三阶段未验证 |
| 最终结论 | **通过** |

技术解释、架构和持久截图见[Windows Core 技术尖峰报告](../../技术设计/Windows-Core技术尖峰报告.md)。

## 详细报告

### 1. 证据边界与提交身份

验证步骤：

1. 固定最终验收对象为完整提交 `7eeb9a8e0974b4356e24abf80c3ade46d486af6e`，检查分支与工作树。
2. 独立读取 Task 9 最终修复/复审、Task 10 实现/独立验收/扫描修复/最终复审与 Logo（标识）验收证据。
3. 区分产品测试提交与随后只写文档的 `docs: record Windows Core spike evidence` 提交。

预期结果：L3 结论只绑定测试提交；文档提交不能替代测试或把旧日志称为新运行。

结果：通过。最终独立复审时 HEAD 为 `7eeb9a8`，结论为通过，发现项 `0/0/0`。完整 30 分钟长稳在前一提交 `5c5fde9` 独立 fresh full（新鲜全量）中产生；`7eeb9a8` 只改扫描脚本和正式单元测试，复审确认运行时/界面/Host/长稳代码未变，并重新运行 `check` 与 `check:core` 通过。未声称在 `7eeb9a8` 重跑了另一轮 30 分钟长稳。

### 2. 精确命令与退出码

除特别说明外，以下 `pnpm` 命令工作目录均为 `try/windows-core-spike/`。

| 命令 | 结果 |
|---|---|
| `pnpm check` | exit 0；最终提交上 unit（单元）20 files / 95 tests、component（组件）5 files / 33 tests、TypeScript/Vite、Rust fmt/clippy/tests 与仓库扫描全部通过 |
| `pnpm check:core` | exit 0；最终提交上 native Core（原生核心）1/1、performance（性能）1/1、日志审计、敏感扫描、普通 release 重建与隔离全部通过 |
| `pnpm check:full` | exit 0，`2091.3 s`；在 `5c5fde9` 独立运行，包含未缩短的 360-cycle/30 分钟 soak（长稳） |
| `node <独立扫描目录>\artifacts\02_discovery\independent-cli-matrix.mjs` | exit 0，21/21；最终扫描修复的独立命令行矩阵 |
| `pnpm exec vitest run tests/unit/repositorySensitiveScan.test.ts --reporter=dot` | exit 0，1 file / 16 tests |
| `pnpm test:unit` | exit 0，20 files / 95 tests |
| `cargo tree --locked --no-default-features -e normal` | exit 0；`wdio|webdriver` 计数 0 |
| normal dist marker scan（普通构建标记扫描） | `__BLOCKY_SPIKE_TEST__`、`wdioTauri`、`wdio:default`、`WDIO_HOOK`、`折叠首块` 计数均为 0 |
| `git diff --check 5c5fde96e0ffe830dc86e313a53cd02269130960..7eeb9a8e0974b4356e24abf80c3ade46d486af6e` | exit 0 |

独立复审者最初给 `pnpm test:unit` 和 `pnpm check` 配置 1 秒外层超时，两次约 5 秒后由工具终止、exit 124，均未形成完整测试结论；随后分别用 120 秒与 300 秒预算从头运行并 exit 0。该异常是 runner（运行器）调度错误，不是产品/测试失败。

### 3. ADR-001 八项门禁

| 门禁 | 验证步骤 | 预期结果 | 实际结果 |
|---|---|---|---|
| 本地 Blockly | 原生 EXE 离线启动、打开工具箱、阻断三类出站 API 并重复载入/编译/运行 | 无 CDN（内容分发网络）或远端依赖；出站账本为空 | 通过；进程连接 `Established=0`、`ExternalEstablished=0` |
| 100 块编辑保存 | 验证精确 100 块/节点；拖动 10 块；有效/非法连接；折叠、缩放；唯一 sentinel 后 UI 保存、关闭重开 | 数量、ID、规范 JSON、SHA-256 与 Host 字节一致；非法连接拒绝 | 通过 |
| 稳定 IR 与回映 | 对语义等价 JSON 重编译；检查 source map 与事件高亮 | IR 字节稳定；事件 block ID 均可定位真实积木 | 通过 |
| 双标签 | 零入口、载入、清空、运行中替换和重开 | 无入口禁用运行标签；生命周期不遗留旧审批/run | 通过 |
| 交互清单 | 零/单/多入口、重命名/重排、两份草稿、六能力增删 | 右栏只由 `InteractionManifest` 投影 | 通过 |
| Tool 统一契约 | Agent 附着与显式调用解析；变更参数后重编译 | 两种用法共享稳定 `toolId` 和同一契约对象 | 通过 |
| 运行路径 | 正常两段流、取消、`/error`、权限拒绝/批准 | 序号单调、唯一终态、拒绝不启动 Tool、批准完成 Tool | 通过 |
| 敏感边界 | 仓库/快照/前后端日志扫描；NUL、编码、JSON 负例；普通构建隔离 | 四目标 0；异常输入失败关闭；无 WDIO 测试能力进入普通包 | 通过 |

### 4. 原始性能样本

验证步骤：原生 WebView 使用 `performance.now()`，每项先做一次不计时预热，再运行 5 次；每个样本必须同时观测 100 块与 100 IR 节点。

| 操作 | 5 个样本（毫秒） | 中位数 / 阈值 | 结果 |
|---|---|---|---|
| load（加载） | `19`、`14.400000000372527`、`14.200000000186265`、`17.700000000186265`、`19.200000000186265` | `17.700000000186265 / 1500` | 通过 |
| runtime（运行） | `0.10000000055879354`、`0`、`0.09999999962747096`、`0.10000000055879354`、`0` | `0.09999999962747096 / 1500` | 通过 |
| saveCompile（保存编译） | `0.6999999992549419`、`0.8000000007450581`、`0.599999999627471`、`3.900000000372529`、`0.1999999992549419` | `0.6999999992549419 / 750` | 通过 |

### 5. 30 分钟稳定性

验证步骤：运行 360 个目标间隔 5 秒的循环；每循环检查 100 块、规范快照摘要、编译诊断、唯一终态和无出站请求；每 12 个循环通过真实 Rust Host 保存/重载；cycle 60 记录预热堆，cycle 360 记录最终堆。

预期结果：时长至少 1,800,000 ms；360/360；Host 保存重载 30 次；堆增量不超过 33,554,432 bytes（字节）。

实际结果：`cyclesCompleted=360`、`elapsedMs=1803033`、`saveReloadsCompleted=30`、`warmHeapBytes=8682986`、`finalHeapBytes=8979466`、`heapDeltaBytes=296480`。应用诊断、敏感值和绝对工作区路径均为 0。结果：通过。

### 6. 人工交互清单

| 项目 | 实际结果 | 持久证据 |
|---|---|---|
| 至少四分类拖动 10 块 | 通过 | [10 块](../../技术设计/Windows-Core视觉验收/02-manual-10-blocks.png) |
| 一个有效、一个非法连接 | 通过；Boolean→JSON（布尔到对象表示）保持分离 | [有效](../../技术设计/Windows-Core视觉验收/03-valid-json-connection.png) / [非法](../../技术设计/Windows-Core视觉验收/04-invalid-boolean-json-rejected.png) |
| 折叠/展开 Agent、入口、Tool | 通过；三类容器均人工检查，完整原始清单已纳入独立复审 | [100 块重开状态](../../技术设计/Windows-Core视觉验收/06-100-blocks-reopened.png) |
| 放大、缩小、重置 | 通过；重置后真实 Blockly 比例为 0.9 | [重置](../../技术设计/Windows-Core视觉验收/05-zoom-reset.png) |
| 100 块保存、关闭、重开、重载 | 通过；同一普通 EXE 与真实 Host 数据 | [重开](../../技术设计/Windows-Core视觉验收/06-100-blocks-reopened.png) |
| 两入口独立草稿 | 通过；Follow-up（后续入口）无文本能力，以独立 Skill 选择与 Chat（聊天）文本草稿证明状态分离 | 技术报告记录人工结果 |
| 六种能力增删 | 通过；文本/图片/文件/语音/Skill/插件均检查 | [六个右栏控件](../../技术设计/Windows-Core视觉验收/07-six-capabilities.png) |
| 正常、取消、错误、权限拒绝/批准 | 全部通过；错误消息已脱敏；批准完成链由原生 E2E、事件断言和人工记录验证 | [正常完成与六能力](../../技术设计/Windows-Core视觉验收/07-six-capabilities.png) / [权限等待与高亮](../../技术设计/Windows-Core视觉验收/08-permission-pending-highlight.png) |
| 高亮与时间线一致 | 通过；权限等待时活动积木与 `tool.permission_requested` 的稳定块 ID 对应 | [等待高亮](../../技术设计/Windows-Core视觉验收/08-permission-pending-highlight.png) |

### 7. 敏感扫描、普通包与 Logo

- 仓库/快照/日志总扫描：`SENSITIVE_SCAN tracked=0 snapshot=0 frontend_log=0 backend_log=0`，exit 0。
- WDIO 日志审计：application diagnostics（应用诊断）0、sensitive matches（敏感匹配）0、absolute workspace matches（绝对工作区匹配）0。
- 普通包隔离：`NORMAL_ISOLATION markers=0 cargo_wdio=0 capability=main`；`withGlobalTauri=false`；唯一能力 `main/core:default`。
- 最终普通 EXE：`try/windows-core-spike/src-tauri/target/release/blocky-windows-core-spike.exe`，11,779,584 bytes，SHA-256 `B3F85E8C3A7709EE77B5CC58592083CB86918B9D856F37307DB8DA5ABA9C781A`（最终扫描修复复审重新构建结果）。
- 批准源 Logo：SHA-256 `12D3F351006663FD07EFD11480101F3C06A43F91633F2E8A914888CA63CF0D9D`；Windows `icon.ico`：SHA-256 `CBBAE888F508EDBA2E051640D992ABB38752D5C9513B53EFE50E400F2C7DB69F`；普通窗口标题栏与页头均清晰、无拉伸或裁切。

### 8. 问题、修复与剩余风险

- 原 Important（重要）：工作区替换遗留审批/run、旧磁盘状态可误过保存探针、含 NUL 文本扫描失败放行，均已修复并由独立复审关闭。
- 原 Minor（次要）：缩放无观测、日志 allowlist/秘密检测假阴性、空运行面板布局，均已修复并由 Task 9 最终复审关闭。
- 保留风险：Vite 主压缩 chunk 大于 1000 kB；人工截图有少量外部通知遮罩；无 BOM 的 UTF-16 严格失败关闭；本次只验证 31 块子集和模拟运行时。
- 未引入重复语义内核、第二份 Tool schema（工具模式）、自动重试、错误抑制或普通包测试后门；尖峰本身仍是一次性代码，正式迁移需拆包、重新版本化与重新验收。

### 9. 工作区外行为与外部写入

- `rustup component add clippy` 写入 `C:\Users\29551\.rustup`。
- WDIO embedded provider 在 `C:\Users\29551\AppData\Local\Temp\msedgedriver\151-*` 建立临时 driver（驱动）目录；未获授权清理，保持原状。
- Task 10 reviewer 在 `C:\Temp` 的精确 sandbox（沙箱）已定向删除；Codex Security 扫描包保留在 `C:\Users\29551\AppData\Local\Temp\codex-security-scans-*`。
- computer-use 返回 `Error: node_repl exec context not found`；后备使用既有 pywinauto/Pillow/OpenCV/Win32，无安装；离线进程网络连接计数为 0。
- CodeRabbit CLI 不存在，未安装；没有 CodeRabbit 结论。
- 未 push（推送）GitHub，未创建 PR、Release（发布）或上架行为。

## 最终结论

Windows Core 技术尖峰的必需 Core、性能、长稳、安全与人工项目全部通过，L3 最终结论为 **通过**。该结论允许进入正式 monorepo 与共享包设计；不允许把尖峰直接称为正式产品、分发、收费、上架或完整 311 块支持。
