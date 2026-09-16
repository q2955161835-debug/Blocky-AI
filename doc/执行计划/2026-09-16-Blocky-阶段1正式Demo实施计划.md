# Blocky 阶段 1 正式 Demo 实施计划

状态：2026-09-16 用户确认全部验收项与最终角色，按 A–F 开发。团队项目，验收通过后先询问是否合并 main。

## 1. 目标与依据

交付 Windows 安装式 Blocky Studio 的首条正式纵切：从资料问答蓝图创建两个模块，修改配置、运行、观察来源、保存重开；同时完成本阶段规定的个人蓝图、锁定仓库候选补丁、显式应用界面、底部面板和通知区域闭环。

依据：[完整开发计划第 11 节](2026-08-23-Blocky-竞品驱动完整开发计划.md)、[正式契约索引](../技术设计/正式契约/README.md)、[阶段 1 接口交接](../技术设计/正式契约/07-阶段1-Demo接口交接.md)、[替换账本](../产品设计/Blocky-状态与阶段替换账本.md)。本计划细化阶段 1，不授权进入阶段 2–14。

执行方式：主 Agent 负责架构与实现，按 A–F 顺序开发；独立 Agent 按已确认验收项检查。仅按需使用单独技能，不默认启用 Superpowers 全流程。任务验收草案见[本次验收记录](../验收/任务/验收-2026-09-16-Blocky阶段1正式Demo.md)，最终角色草案见[验收模板](../../.agents/模版/Blocky阶段1桌面产品交付验收.md)。

## 2. 当前起点与约束

- 起始提交：`8ac926fc9affafeab7a0bc58e0006b5c5a54d0ad`；开始时 `main` 工作区干净。
- 任务分支：`codex/feat-stage1-formal-demo`；变更前检查点：`25f0117`。
- 阶段 0 契约完成；课程助教 POC 的历史验收属于尖峰，不计为本次正式产品通过。
- 起点提交尚无正式 monorepo；A–E 已建立正式根命令与包，当前可执行命令以根 `package.json` 为准。下述勾选清单保留最终逐项核对，不能用实现完成替代验收。
- 技术栈沿用 React、TypeScript、Blockly、Tauri 2/Rust、pnpm、Vitest 和 Windows 原生测试。实施 A 时从已锁定尖峰依赖核对实际可安装版本，正式根独立锁定；不整体复制尖峰或依赖尖峰源码。
- 数据事实为 Project Manifest 与每模块 Blockly Workspace JSON；会话、IR、日志、终端历史和审计不进入项目事实。
- `v1alpha1` 不静默改义。需要补充类型或错误码时，先同步正文、正反夹具、消费者和迁移说明。
- 产品界面、项目、事件和设置不加 `demoMode`、演示徽标或特殊绕行逻辑。
- 确定性 Provider、知识和仓库适配器通过正式端口注入；无真实外部模型请求。不复制历史 API 调用证据。
- 不建立六个兼容适配器、官方 Skills、真实 RAG 或真实 RPA。2026-09-16 用户要求同步开发 CLI，按 [CLI 补充计划](2026-09-16-CLI同步开发补充.md) 提前开放已实现领域的 CLI 入口并优先用 CLI 验证。
- 测试、编译和原生验收均使用当前提交，记录命令、退出码和证据；历史结果不替代重跑。

## 3. 架构与包建立顺序

```text
studio-desktop → project-model / command-system / ui-editor / ui-runtime
Workspace → compiler → ModuleIR / ProjectIR / InteractionManifest
                                  ↓
                             runtime-core ← registered adapters
                                  ↓
                            observability → highlight / logs / trace
studio-host ← project-format / terminal-protocol / app-surface ports
builder-protocol ← conversion-core → review → project-model transaction
```

包按消费者需要建立，不先创建全部空包。纯领域包不得导入 React、Tauri IPC、Node 文件系统或 `try/windows-core-spike`；Host 处理能力、路径、写盘和生命周期，前端只获得受控引用。

| 批次 | 新建主要目录 | 独立可验证产物 |
|---|---|---|
| A | `packages/language-schema/`、`project-model/`、`block-catalog/`、`compiler/`、`test-fixtures/` | 两模块项目从真实 Workspace 编译、链接、生成入口清单；非法引用可定位 |
| B | `packages/runtime-core/`、`observability/`、`resource-registry/` | 确定性问答经过正式权限和事件流，引用、警告、失败、取消与三投影一致 |
| C | `apps/studio-desktop/`、`apps/studio-host/`、`packages/ui-editor/`、`ui-runtime/`、`project-format/`、`command-system/`、`settings-schema/` | Windows 普通应用内完成创建、编辑、运行、导航和保存重开 |
| D | `packages/builder-protocol/`、`conversion-core/`；扩展目录与编辑器 | 多选个人蓝图和锁定仓库候选补丁，经审阅和原子事务应用 |
| E | `packages/app-surface/`、`terminal-protocol/`；扩展 Host 与面板 | 显式页面预览、具名任务、日志导出、通知区域和真正退出 |
| F | `tests/e2e/`、`tests/fixtures/`、交付说明和验收证据 | 普通 Windows 产物与本阶段完整用户旅程正式验收 |

## 4. 实施任务与验证

每批次执行：编写关键行为失败测试 → 确认失败原因 → 实现 → 运行相关测试 → 独立局部验收 → 提交。验收与实现失败时先修复本批次，不扩大到无关功能；A–F 验收项本轮一起确认，范围变化再确认受影响项。

### A. 正式项目、编译与链接

文件：根 `package.json`、`pnpm-workspace.yaml`、`pnpm-lock.yaml`、`tsconfig.base.json`、`vitest.config.ts`；`packages/language-schema/src/` 按公共类型、项目、IR、运行、补丁和 Host 协议分文件；`packages/project-model/src/project.ts`；`packages/compiler/src/{compile,link,interaction}.ts`；`packages/block-catalog/src/`；`packages/test-fixtures/src/`；`tests/contracts/`；`.github/workflows/check.yml`。

接口：`parseProject(input: unknown)` 返回项目或结构化诊断；`compileWorkspace(projectId, module, workspace, catalog)` 返回 ModuleIR 与 Diagnostic；`linkProject(project, modules, schemaRegistry)` 返回 ProjectIR 与诊断；`projectInteraction(modules, catalog)` 返回 InteractionManifest 和 ToolContract。具体参数类型来自正式契约，由语言包统一导出。

- [ ] 注册 21 个已冻结 Schema 的读取边界和未知字段策略；拒绝未知执行枚举、非法 StableId、越界相对路径、重复标识与非法引用，不把 TypeScript 类型断言当输入校验。
- [ ] 新建资料问答伙伴的真实 Blockly Workspace JSON。阶段 0 `minimal-multi-module-project.json` 中的 `topBlockIds/workspaceDigest` 只是交接摘要，不能直接当作可运行 Workspace，不能信任其占位 digest。
- [ ] 实现本旅程需要的最小通用积木及配置；保持十二类专业分类与七类入门投影，尚无实现的能力不能显示为可运行。
- [ ] 从 Workspace 生成 source map、ModuleIR、跨模块引用和运行入口；类型不匹配与同步环在链接时失败，模块显示名改变不改变链接。
- [ ] 对十个既有夹具建立唯一 `caseId` 注册表；A 先落实项目/链接断言，其余明确列待覆盖消费者，F 前不得遗漏或跳过。
- [ ] 建立根 `typecheck`、`test:unit`、`test:contracts`、`check` 命令和 Windows CI；CI 安装使用 `pnpm install --frozen-lockfile`，不启用发布、部署或自动推送。

关键测试例：

```ts
const result = compileAndLink(twoModuleWorkspaceProject);
expect(result.diagnostics).toEqual([]);
expect(renameModuleAndCompile(result, "新的显示名").links).toEqual(result.links);
expect(removeExportAndCompile("lookup-v1").diagnostics.map(d => d.code))
  .toEqual(["BLK-LINK-002"]);
```

以上三个 helper 在 `tests/contracts/helpers/project.ts` 中实现，仅组合正式编译接口和测试输入；不硬编码诊断。补充环、类型冲突、路径穿越、重复标识和被篡改派生缓存负例。

批次命令：`pnpm typecheck`、`pnpm test:unit`、`pnpm test:contracts`。验收映射：S1-01 的领域部分、S1-02 的诊断部分；本批次通过不代表桌面用户旅程完成。

### B. 可运行问答与同源可观察性

文件：`packages/runtime-core/src/{run,adapters,event-factory}.ts`、`packages/observability/src/{redact,bus,projections,export}.ts`、`packages/resource-registry/src/registry.ts`、`packages/test-fixtures/src/{knowledge,provider,clock}.ts`；测试放各包 `tests/`。

接口：运行入口消费已编译入口 ID、ProjectIR、ModuleIR、资源注册表及注入适配器；提供 `AbortSignal` 和事件订阅。唯一事件工厂分配进程内单调序号，正式 RuntimeEvent 是高亮、日志和轨迹唯一输入；未注册 implementationRef 拒绝执行。

- [ ] 角色、资料与回答方式配置实际影响确定性适配器输入和答案投影；回答绑定命中来源，无证据问题返回待核实，不能总返回固定成功文案。
- [ ] 实现资源 scope 明确解析、权限取交集、secretRef 绑定和缺失配置诊断；没有真实秘密存储时不得谎报配置成功或发网络请求。
- [ ] 实现正常完成、警告、工具失败和取消；终态后拒绝同 runId 执行事件；超时和取消传播到适配器。
- [ ] 先规范化和脱敏再发布；总线有事件/字节预算及丢弃计数，高级别异常不能静默丢失。
- [ ] 用固定时钟和适配器重跑同一输入，比较完整结构化事件；通过真实投影核对来源、颜色/轮廓语义和 traceTarget，禁止只检查文本包含“成功”。

批次命令：`pnpm test:unit`、`pnpm test:contracts`。验收映射：S1-03、S1-05、S1-10 的领域部分。脱敏与权限负例独立验收使用符合安全验收规则的 Agent。

### C. 桌面编辑、原生保存与会话

文件：`apps/studio-desktop/src/{app,composition}/`、`apps/studio-host/{Cargo.toml,tauri.conf.json,capabilities,src}/`；编辑器包按 `canvas/`、`tabs/`、`inspector/`、`bottom-panel/` 拆分；运行 UI 包按 `interaction/`、`trace/` 拆分；项目格式包和命令/设置包各自拥有 `src/` 与 `tests/`。

接口：前端通过窄 Host 端口选择、加载和保存项目，以 Host 返回的句柄引用目标；Project Model 提交事务后编译。项目格式仅打包声明的 Manifest、Workspace、资源和可选 AppSurface 来源；会话独立持久化。

- [ ] 建立真实欢迎页→蓝图→两个画布→配置→运行流程，右侧控件只读取 InteractionManifest。
- [ ] 实现稳定跨模块跳转、显示名修改、丢失导出定位、标签关闭/恢复；Project Map 如提供，只做导航。
- [ ] 顶部菜单、命令中心、快捷键和右键共享 CommandDefinition；统一互斥弹层。实现中键平移、Space 临时平移、指针中心滚轮缩放与搜索入口。
- [ ] 接入运行高亮覆盖层和日志/轨迹定位，保持尺寸不变，图标文字及减少动效可用。
- [ ] 实现原子保存、取消保存、失败恢复、重新打开重编译；注入写入失败验证旧文件原字节保留。恶意引用、损坏文件和未知版本在 Host 边界拒绝。
- [ ] 会话布局不进入项目语义摘要；设置仅显示已有消费者，并给出继承来源和恢复继承；不接受真实凭据输入。
- [ ] 建立 `pnpm dev`、`pnpm build`、`pnpm test:component`、`pnpm test:host`、`pnpm test:e2e:build` 和 `pnpm test:e2e`。普通构建与带测试能力构建分离。

批次验收：在新建的正式 Windows 普通产物上完成 S1-01、S1-02、S1-03、S1-07；聚焦原生自动化验证当前包。不能用尖峰的已编译 EXE 代替正式应用。

### D. 个人蓝图与候选补丁

文件：`packages/block-catalog/src/blueprints/`、`packages/builder-protocol/src/{validate,preview,apply}.ts`、`packages/conversion-core/src/{snapshot,evidence,candidates}.ts`，以及编辑器 `selection/` 与 `patch-review/`。

接口：转换器只读锁定快照，产出 BuildSpec、候选证据及 SemanticPatch；项目模型校验当前 baseDigest、catalogVersion 和独立权限批准后原子接受。蓝图插入使用同一事务与 ID 工厂。

- [ ] Shift 点击增减选择不拖拽；空白框选与整体移动保持相对布局；复制/删除/插入各只形成一次撤销记录。
- [ ] 保存多顶层个人蓝图；必需外部依赖转公开插槽或阻止保存；重新插入生成新稳定 ID，展开后可编辑原子积木。
- [ ] 锁定仓库夹具的 commit、许可证、依赖和文件证据，输出可解释的自定义积木/蓝图候选；不网络克隆、不执行仓库代码。
- [ ] 幽灵预览完整显示结构和权限差异；拒绝、过期基线、非法引用、应用中途失败均保留原文件集合与字节；接受后的编译结果正确且可整体撤销。

批次命令：`pnpm test:unit`、`pnpm test:contracts`、`pnpm test:component`、聚焦 `pnpm test:e2e`。验收映射：S1-04、S1-06。

### E. 显式页面、具名任务、面板与 Windows 生命周期

文件：`packages/app-surface/src/{manifest,bridge,preview}.ts`、`packages/terminal-protocol/src/{task,request,session}.ts`；Host `src/{project_store,task_host,preview_host,window_lifecycle,log_store}.rs`；相关组件与测试按模块分目录。

接口：页面通过显式用户命令形成 SemanticPatch；FrontendBridge 只暴露登记端点。UserTerminalSession 与 AgentProcessRequest 使用不同协议、句柄空间和能力校验。WindowLifecycle 在资源结算成功后才进入 exited。

- [ ] 新项目零页面；显示锁定前端源码、依赖、Bridge 与权限差异；接受后本地隔离预览，拒绝和普通 Agent 请求保持零页面。关闭浏览器标签保留页面产物。
- [ ] 原生预览使用每项目隔离存储；不暴露 Tauri 对象，不允许未声明端点、任意本地路径或远程代码。增加跨项目存储与跨源调用负例。
- [ ] 四视图分别消费 Diagnostic、RuntimeEvent 投影、独立具名任务和 LogEnvelope；折叠面板不停止任务。
- [ ] 运行一个锁定具名任务；验证参数、平台、并发、时间、输出字节预算、取消和退出码。阶段 1 不宣称实现任意交互式 Shell/PTY。
- [ ] 拒绝所有 Agent 附加用户终端的请求；模拟 RPA 仅用于契约校验，无真实桌面副作用。
- [ ] 日志通道筛选、清除视图与清除存储互不混淆；显式诊断导出再次脱敏并排除正文、终端输入和凭据。
- [ ] 实现通知区域恢复、暂停、运行日志与退出菜单；隐藏继续已授权任务但不能启动新任务；脏项目关闭保护、第二实例转交、真正退出结算可读回。
- [ ] 退出后从系统进程/端口和文件锁验证 Host、预览、注册任务与日志句柄释放；没有创建 PTY 的实现标注“不适用”，不得用伪造零计数冒充验证。

批次命令：领域/组件/Host 测试与聚焦原生 E2E。验收映射：S1-08、S1-09、S1-10；这一批包含 L3 边界，安全部分由未参与实现的 astra + medium 或更高配置独立验收。

### F. 完整交付与最终验收

- [ ] 建立正式 `pnpm check:core` 和 `pnpm check:full`，组合本项目正式测试；长稳保留至少 360 个 5 秒循环与 30 次真实 Host 保存/重载，不缩短后称完整通过。
- [ ] 在开发完成提交上运行类型、单元、契约、组件、Rust、原生 E2E、性能、长稳、普通包隔离及敏感扫描；性能采用原有 Core 门禁中的具体阈值并记录硬件/分辨率，阈值改变须说明依据。
- [ ] 未参与实现的独立最终验收 Agent 使用已确认角色模板，在普通 Windows 产物完成 S1-01–S1-11；与已验证的安全分项绑定同一代码提交/产物，后续修改使受影响结果失效。
- [ ] 输出产物字节数/SHA-256、无秘密截图和测试证据；真实大模型 API 调用结论明确为“否”，没有凭据的真实调用不作为本阶段默认门禁。
- [ ] 更新 README、AGENTS、替换账本、跨模块与模块验收；阶段 1 全部通过后才标记完成并归档本计划。正式应用前已有尖峰和赛事交付物保留原状态。
- [ ] 仅“通过”或“用户确认通过”后合并 main 并删除任务分支；“有条件通过”不默认合并。遵守项目定位规则，个人/团队归属未确认时先明确主线合并方式。
- [ ] 按本机用户仓库规则询问是否 push；本轮继续开发授权不包含 push、PR、发布或外部提交。

## 5. 验收、证据与恢复

验收唯一索引为[本次任务验收](../验收/任务/验收-2026-09-16-Blocky阶段1正式Demo.md)。局部验收只覆盖当前批次与直接依赖；最终验收覆盖本次完整用户旅程与核心交叉流程，不重复尖峰全盘验收。

新日志、截图、测试包与实验脚本存 `try/`；清理前核对 Git 和保留要求，未清理的按 `try/待清理/<产物名>/` 整理并报告大小。正式验收需要的精选无秘密证据存 `doc/验收/任务/` 对应证据子目录。运行时默认目录如落在工作区外，必须提前或首次产生时记录完整地址。

代码变更可通过任务提交回退；单次补丁和保存另有应用级原子回退。不能以覆盖旧项目、删除工作区或复制整份尖峰作为修复。连续三次调试失败先查官方文档/技术社区，再决定下一步。

## 6. 本次确认点

2026-09-16 用户回复“确认全部，按 A–F 顺序开发”，本次标准与角色全部确认；范围或标准变化再补充确认。用户确认为团队项目，验收通过后先询问是否合并 main。

本计划完成实施后在此记录归档日期与最终验收链接；当前仍为待执行计划，不归档。

## 当前批次执行状态（2026-09-16）

22:04 用户明确“继续开发，可以进行电脑操控验收”，恢复F普通窗口及生命周期验收。原暂停记录仅为历史时序，不再阻止本轮执行；发现问题继续在当前任务分支修复并独立复验。

| 批次 | 实施状态 | 仍需验证 |
|---|---|---|
| A/B | 共享项目、编译/链接、资源、确定性运行及可观察性已实现，限定范围独立验收见任务报告 | 正式普通完整旅程 |
| C/D | 编辑器、原生归档、会话、蓝图/插槽、候选补丁与 CLI 已实现，领域/组件/安全分项有独立结果 | 普通窗口、手势及原生对话框操作 |
| E | 显式页面、注册任务、诊断与退出代码已实现；Wry 隔离和日志计数缺陷已修复并限定复验 | 普通包托盘/关闭/完整退出 |
| F | 正式 Core/Full 命令、测试隔离通道、发行候选、性能与360循环/30次原生重开的Full端口已完成；扫描与313项许可证检查通过 | 普通交互、托盘/关闭与最终普通旅程；根聚合门禁和CI未完整执行 |

下方用户后续调整只改变验收时序。不能因为电脑操控暂缓而免除必需项，不能据此合并或进入阶段 2。2026-09-16 最新指令“暂不执行电脑操控验收，继续后续开发”：停止 CU/普通界面操控，继续 CLI、代码和无鼠标键盘的自动化门禁。

## 2026-09-16 后续顺序确认

用户已确认：先继续 D/E，C 普通界面验收留到 F。C 的 CLI/组件和入口修复局部验收已通过；当前测试包原生 E2E 两项通过；普通包因目标窗口激活失败阻塞，未发送输入，不计为普通桌面验收通过。此调整只延后普通界面验证，不删除标准或提前通过最终门禁。
