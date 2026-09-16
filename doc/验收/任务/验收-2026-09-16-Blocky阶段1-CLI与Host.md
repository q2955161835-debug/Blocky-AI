# 阶段 1 CLI 与 Host 独立局部验收

## 当前限定结论：通过

CLI-01、CLI-02 及修复引入的 URI 误脱敏已于 `bdc90e96dff78f270d7e1e29d7b26068747f3848` 复验关闭；新增 project.configure 已于 `786226763327639c1920ddd865c4014cf3fb4d93` 独立增量验收通过。**最终结论：通过**。限定为本报告 CLI/共享 Host 项目读写边界；未执行 GUI、最终桌面包或阶段 1 总验收。下文保留初验及复验一的历史失败证据。

真实大模型 API 调用：**否；未真实调用外部大模型 API**。
## 初验汇总表格

| 项目 | 内容 |
|---|---|
| 执行人 | 独立验收 Agent `accept_stage1_b`，未参与本次实现 |
| 本地时间段 | 2026-09-16 17:36 ~ 2026-09-16 17:40（Asia/Shanghai） |
| 验收基线 | `fcc464871933a4474bbf9482bbefedc3d055d65e`；开始时工作区干净 |
| 范围与等级 | S1-12，及共享 project_store / strict_json / native helper / commands / project-format 的直接读写边界；L3 |
| 结果 | CLI 构建通过；既有 CLI 8、Rust 7、project-format 2 项全部通过；独立反例发现 2 个问题 |
| 最终结论 | **不通过** |
| 真实大模型 API 调用 | **否；未真实调用外部大模型 API** |

| 编号 / 用户场景 | 验证结果 | 风险与定位 |
|---|---|---|
| S1-12 命令发现与机器输出 | 局部通过 | 真实子进程 JSON/JSONL 可解析，退出码分类和缺少原生 companion 负例通过 |
| S1-12 显式运行与取消 | 通过 | 无 simulate 拒绝；live 拒绝；超时终态取消；成功运行有引用且 modelApiCalled=false |
| S1-12 创建、读取和共同领域实现 | 局部通过 | ZIP 创建、同名冲突及并发冲突不覆盖、同输入 Compiler 摘要一致；共享实现路径已核对 |
| CLI-01 资源秘密边界 | **不通过，P1** | `token` / `secret` 字段可入包，Host read 将秘密原值返回 files |
| CLI-02 输出私有路径 | **不通过，P2** | 项目显示名中的虚构绝对路径被 inspect 原样写入 stdout |
| ZIP、格式和协议拒绝 | 通过 | 穿越、重复 ZIP 名/大小写、重复 JSON 键、未知格式/Reader 版本、超限解压、Unix 符号链接均拒绝 |

## 详细报告

### 1. 脚本使用者操作 CLI

#### 1.1 命令发现、JSON/JSONL 与退出码

执行 `pnpm build:cli` 构建当前 CLI 和 Rust companion。既有真实 CLI 子进程测试验证 help 只列已实现命令、doctor 读真实 companion 版本、目录分页、未知参数拒绝、缺少 companion 退出 6。

独立脚本实际调用根目录 `blocky.cmd`，立即读取 `$LASTEXITCODE`，没有以 pnpm 的包装退出码替代 CLI 分类。创建退出 0；同名冲突 5；未知参数/重复参数及未显式 simulate 为 2；live 请求为 4；1 毫秒截止取消为 7。成功问答输出 21 行可解析 JSON：20 条正式 RuntimeEvent 加一条 blocky.cli/v1 结果，首事件 run.started、尾执行事件 run.completed；取消输出最后执行事件 run.cancelled。

所有这些命令只启动 Node CLI 和原生存储 companion。没有调用 Computer Use、GUI、WebView 或交互对话框。静态入口读回确认 companion 仅执行存储协议，桌面 Tauri main 不属于 CLI 启动入口；没有真实外部模型适配器路径。

#### 1.2 CLI-02：项目来源字符串绕过 stdout 路径保护（P2）

通过当前 companion 创建合法项目，只把 `manifest.displayName` 改为包含 `FICTIONAL_PRIVATE_FOLDER` 的虚构 Windows 绝对路径。创建返回 ok=true。执行 `project inspect --json` 退出 0，stdout 中显示名保留整个路径。

证据：`try/accept-stage1-cli/supplement.json` 的 `private-path-output` 为 `created=true, code=0, privatePathReturned=true`。源码 `tools/blocky-cli/src/commands.ts` 直接把 displayName 放进 envelope，`main.ts` 直接 JSON.stringify，没有对来自项目的文本执行输出脱敏。

S1-12 已确认标准明确要求输出不回显本机绝对路径。当前错误消息虽不回显输入路径，正常项目数据输出仍未满足。建议对机器可见的项目显示文本和诊断输出实行结构化隐私策略，同时避免偷偷改变编译语义摘要。此反例仅使用虚构路径，没有读取其中的文件。

### 2. 用户创建和读取项目

#### 2.1 原子创建、冲突及存储实现一致性

既有原生测试实际写 ZIP、重开并替换，注入提交前失败后保留旧字节、目录无残留临时文件。CLI 创建结果哈希匹配真实文件；同名创建后 SHA-256 不变。

独立额外运行两个 CLI 进程同时创建同一路径：退出码集合为 [0,5]，最终落盘哈希匹配成功进程的工件哈希。代码确实使用 tempfile.persist_noclobber，而非先 exists 后覆盖。

CLI 和桌面调用同一 `@blocky/compiler`、`@blocky/runtime-core`、`@blocky/project-format`；桌面 commands 和 CLI companion 共用 Rust project_store。既有 CLI 测试把 CLI 编译结果摘要、InteractionManifest 与直接领域调用对照，并确认只读命令前后项目字节未变。本轮没有重复运行 B 运行内核全套验收。

桌面 commands 仅作源码边界检查：Webview 标签必须为 main；保存既有项目用 Host 维护的随机 handle，而非接受前端任意路径；新建/打开通过对话框取得路径。本轮按明确要求未调用 GUI，未动态验证窗口身份或对话框流程。

#### 2.2 CLI-01：通用秘密字段可穿过 Host（P1）

在合法模型资源的 definition 内分别添加 `token` 与 `secret`，值使用明确虚构标记。其余项目事实不变，生成两个 ZIP 包。

实际观察：

- 两个包经 `blocky.cmd project validate ... --json` 均退出 0，而期望秘密边界拒绝。
- 原生 companion `read` 对两者均返回退出 0、ok=true，并在 files 中原样返回虚构秘密值。
- 共享 `project_store::check_secrets` 仅枚举 apiKey、authorization、password、cookie、accessToken、refreshToken、clientSecret、privateKey，遗漏 token 和 secret；resource definition 允许这些 JSON 字段。

此问题不是只影响 CLI 文案：桌面 `open_project` 使用同一 read_archive，随后把 ProjectFiles 交给 WebView。因而现有共享读入边界不能保证秘密值不进入前端。当前产物没有外部模型调用；没有声称真实凭据已遭泄露。

证据：`results.json` 的 token/secret 用例退出 0；`supplement.json` 中 native-read-token/native-read-secret 均为 `secretValueReturned=true`。修复应在共享 Host 读写校验层覆盖通用凭据字段，保持 secretRef/secretBindings 等引用结构合法，并添加拒绝/无落盘反例。

### 3. 不可信项目包与原生协议

独立构造并经当前 CLI/原生进程验证：

| 输入 | 实际结果 |
|---|---|
| ZIP 条目 `../escaped.json` | CLI 3 / BLK-LOAD-001 |
| 同名重复条目、大小写重复条目 | CLI 3 / BLK-LOAD-001 |
| project.json 重复 schemaVersion 键 | CLI 3 / BLK-LOAD-001 |
| 未知 project schema、minimumReaderVersion=99.0.0 | CLI 3 / BLK-LOAD-001 |
| 解压内容 9 MiB、压缩后小于读入预算 | CLI 3 / BLK-LOAD-001 |
| ZIP 中带 Unix 平台与符号链接 mode 的条目 | CLI 3 / BLK-LOAD-001 |
| companion 未知协议版本、额外参数、未实现 save 操作 | companion 3 / ok=false |

Host 在内存读包，没有解压至任意文件路径。strict_json 对重复键拒绝，Rust 与 TypeScript 格式入口均有预算。本轮不把 TypeScript 单独 JSON.parse 视为原生入口的重复键绕过：实际项目读入先经过 Rust strict_json。

## 命令、工件与证据

| 命令 | 退出码 | 结果 |
|---|---:|---|
| `pnpm build:cli` | 0 | 当前 CLI 与 companion 构建成功 |
| `pnpm test:cli` | 0 | 8/8 |
| `pnpm test:host` | 0 | 库 6/6，companion 1/1 |
| `pnpm exec vitest run packages/project-format/tests/format.test.ts` | 0 | 2/2 |
| `pwsh -NoProfile -File try/accept-stage1-cli/check.ps1` | 0 | 驱动成功；每条 CLI 原始退出码见 results.json，token/secret 与期望不符 |
| `node try/accept-stage1-cli/supplement.mjs` | 0 | 驱动成功；秘密回传、路径输出和并发结果见 supplement.json |
| `pwsh -NoProfile -File try/accept-stage1-cli/zip-check.ps1` | 0 | 驱动成功；ZIP 重复条目拒绝；符号链接修正平台字段后单独调用拒绝 |

脚本驱动退出 0 只说明实验运行完毕，绝不代表全部验收通过。脚本以 CreateNew 避免覆盖证据，复跑应使用新的空目录。

| 工件 | 字节数 | SHA-256 |
|---|---:|---|
| `tools/blocky-cli/dist/main.mjs` | 603432 | `bfbde4dc7b16bdfb54ffce20158c2ac030c5340f2b269d9c4fd4ea513be35a4e` |
| `tools/blocky-cli/dist/bin/blocky-project-io.exe` | 919040 | `817c9e77642c170d47ed20bcca81d3ab7b65f3c9eae8afb1d5672c5e11f8d12c` |

这是本轮 CLI 工件，不是阶段 1 最终桌面包。未执行 release 桌面敏感扫描、Full 长稳或远端 CI，不对此作通过结论。

## 范围限制、异常与存储

- 验收结束时主 Agent 正在并行修改桌面会话/导航、project-model 等文件；本轮目标 tools/blocky-cli、apps/studio-host 既有被验收文件、packages/project-format 相对验收提交没有实现 diff。未触碰其他 Agent 修改，也未运行根 check。
- 错误汇报：初次大小写重复 ZIP 生成使用 PowerShell 不区分大小写 Hashtable，实际覆盖了映射而未生成重复条目，已剔除该无效结果并使用 ZIP 条目列表正确重测。初次符号链接 ZIP 只有 mode 而仍标记 DOS 平台，不能代表 Unix 链接；改为 Unix 平台后真实负例已拒绝。没有把夹具构造错误误报为产品缺陷。
- 工作区外：Rust 测试的 tempfile 默认短暂使用 `C:\Users\29551\AppData\Local\Temp` 下随机子目录，测试结束由 RAII 删除；未记录随机目录名。除此之外未主动写入工作区外；构建使用已安装工具链，没有安装依赖。
- 复现、ZIP 与摘要存放 `D:\1Folder\Blocky-AI\try\accept-stage1-cli`，约 64.7 KB，因两项未通过仍需修复复验而保留。它们仅含虚构敏感标记，不含真实凭据。
- 仅新增本验收报告和上述 try 证据，没有修改实现或进展记录，没有提交、合并、推送。主 Agent 负责集中记录和处理临时产物。
- 当前结论仅为 CLI/Host 局部不通过；不替代阶段 1 总验收。

## 复验一：CLI-01/02 修复及直接影响

本地时间段：2026-09-16 17:44 ~ 2026-09-16 17:46。目标提交：`984220e0235e6d9decb10e06a460e888f2c00da4`。仅复验既有问题与输出修复直接影响，未运行全盘测试。

### 当前限定结论：通过

CLI-01、CLI-02 及修复引入的 URI 误脱敏已于 `bdc90e96dff78f270d7e1e29d7b26068747f3848` 复验关闭；新增 project.configure 已于 `786226763327639c1920ddd865c4014cf3fb4d93` 独立增量验收通过。**最终结论：通过**。限定为本报告 CLI/共享 Host 项目读写边界；未执行 GUI、最终桌面包或阶段 1 总验收。下文保留初验及复验一的历史失败证据。

真实大模型 API 调用：**否；未真实调用外部大模型 API**。
## 初验汇总表格

| 项目 | 结果 | 证据 |
|---|---|---|
| CLI-01 创建拒绝 | 通过 | token、secret、credential、credentials 四个虚构字段分别经 native create 返回 3 / BLK-SECRET-001，目标文件均未生成 |
| CLI-01 读取拒绝 | 通过 | 保留的 token/secret 两包经 native read 返回 3 且无 files；直接 blocky.cmd validate 均退出 3 |
| 引用与原子冲突直接影响 | 通过 | 原知识资源 secretBindings/secretRef 保留；已有目标 native create 返回 BLK-CONFLICT-001，原 SHA-256 不变 |
| CLI-02 原始路径反例 | 通过 | inspect 移除虚构路径、产生 warnings；磁盘字节不变，输出 digest 匹配原始项目领域摘要 |
| CLI-02 正常安全编译直接影响 | 不通过 | 初次正常项目 compile 的 implementationRef 被从 `adapter://deterministic/knowledge-v1` 改为 `adapte[本机路径]` |
| 本轮结论 | **不通过** | 路径匹配误判 URI，需要修复后再次验证 |

### 详细报告

通过 stdin 提交内联 Node/tsx 断言，直接调用已更新 companion 与 CLI 产物；没有新增复现脚本或修改实现。秘密创建、秘密读取、引用和原子冲突断言通过后，正常项目编译的 warnings 应为空断言失败，Node 退出 1。进一步直接执行 `blocky.cmd project compile ... --json`，观察工具 implementationRef 为 `adapte[本机路径]`。

根因属于本次修复直接影响：Windows 盘符正则缺少前缀边界，将 URI 末端 `r:/` 当作盘符，且下层 redact 同样匹配。CLI 的普通安全 ToolContract 输出因此不再与领域结果一致。本次未以加入 warning 掩盖正常引用损坏。

随后主 Agent 并行修改这两个正则并重建产物；过程中额外对照的结果已恢复 URI，但当时源码未提交，不能绑定为 984220e 的通过证据。待精确新提交后单独记录最终复验和产物哈希。原始路径反例中，原包字节、原始显示名和 projectDigest 均保持不变。

真实大模型 API 调用：**否；未真实调用外部大模型 API**。本轮未调用 GUI；未主动在工作区外读写。仅报告被修改，拒绝创建的测试路径均未产生文件。没有重跑 CLI/Host 全套；主 Agent 所述先红后绿及全套结果未冒充本 Agent 新运行。


## 复验二：正常安全编译输出

本地时间段：2026-09-16 17:47 ~ 2026-09-16 17:47。精确提交：`bdc90e96dff78f270d7e1e29d7b26068747f3848`。

### 汇总表格

| 项目 | 验证结果 |
|---|---|
| 正常编译 ToolContract | 通过；CLI tools 与直接 Compiler 的完整数组深度相等，adapter URI 保持原值 |
| IR、InteractionManifest、摘要 | 通过；分别深度相等/摘要相等 |
| 正常安全输入 warnings | 通过；空数组 |
| 源项目字节 | 通过；命令前后 SHA-256 相等 |
| CLI-01 与路径隐私反例 | 沿用复验一有效证据；本次范围内变更只有两处盘符正则前置边界，Host 无变更 |
| 最终结论 | **通过**，限本报告范围 |

### 详细报告与工件

按约定仅重跑安全编译对照：通过 stdin 执行 `node --import tsx --input-type=module` 内联断言，启动当前 CLI/companion；退出码 0，输出摘要 `compileExit=0, toolsEqual=true, irEqual=true, interactionEqual=true, digestEqual=true, warnings=0, bytesUnchanged=true`。未把旧的全套测试结果写成本提交新运行。

当前 CLI 产物读回：

| 工件 | 字节数 | SHA-256 |
|---|---:|---|
| `tools/blocky-cli/dist/main.mjs` | 604394 | `8f97d0c9bc2d3a72e0e8fab25403e8019e4c387200cacefb0588acf4b1ec2343` |
| `tools/blocky-cli/dist/bin/blocky-project-io.exe` | 919552 | `dc891bc58934c9c7cfbcfd2c59cf18ef5e5c0a2af9506e7b06727cbcb2ea976f` |

这不是普通最终桌面包的验收结论。真实大模型 API 调用：**否；未真实调用外部大模型 API**。本轮仅修改此报告，未新增工件或工作区外读写，未调用 GUI、根 check 或其他模块回归，没有提交、合并或推送。


## 增量验收：project.configure

本地时间段：2026-09-16 17:55 ~ 2026-09-16 17:56。精确提交：`786226763327639c1920ddd865c4014cf3fb4d93`。范围仅新增 CLI project.configure 和共享 configureBlock；没有重跑 ZIP、Host 或既有 CLI 全盘验收。

### 汇总表格

| 使用场景 | 结果与最少证据 |
|---|---|
| 修改生效 | 通过；ROLE 改为科学教师后保存新包，模拟运行返回“学习要点”，modelApiCalled=false |
| CLI/桌面共享领域 | 通过；CLI configure 与桌面 updateField 均调用 @blocky/project-model 的 configureBlock；未用 GUI 验证桌面交互 |
| 不覆盖与源文件保护 | 通过；新目标再次创建退出 5、哈希不变；以源文件作输出也退出 5；全部试验后源 SHA-256 保持 |
| 目录字段边界 | 通过；不存在模块/块、未声明 API_KEY 字段退出 3；无新文件 |
| 无效值拒绝 | 通过；非法 STYLE、16001 字符角色退出 3；直接共享函数非字符串输入抛 BLK-CONFIG-001 |
| 带诊断编辑保存 | 通过；EXPORT 改为缺失导出后保存退出 0，返回 error 诊断及 warning；随后显式模拟运行退出 3，未产生 run.started |
| 秘密输出与 live | 通过；虚构 token 文本不出现在 compile stdout，存在脱敏 warning；configure 附加 --live 退出 4 且无落盘 |
| 增量最终结论 | **通过**，仅此命令及共享领域函数 |

### 详细报告与验证命令

`pnpm exec vitest run packages/project-model/tests/configure.test.ts`，退出码 0，1/1 通过，涵盖共同字段编辑、目录外字段拒绝及一步撤销。

另通过 stdin 运行 `node --import tsx --input-type=module` 独立断言，使用真实 CLI 子进程和源包完成上表场景；驱动退出码 0，输出 11 组断言全部通过。脚本直接调用 Node 的已构建 CLI 入口，读取真实子进程 status，不以 pnpm 包装码替代分类。本次没有重新执行实现方的 10 项完整 CLI 测试，也没有把其结果写成本 Agent 新执行。

正常合法修改、预期编译诊断和非法配置分开判定：缺失导出是可保存修复的项目编辑状态；非法 STYLE、未知字段及非字符串属于配置边界拒绝。没有为了通过而把诊断保存视为运行成功。

| 当前 CLI 工件 | 字节数 | SHA-256 |
|---|---:|---|
| `tools/blocky-cli/dist/main.mjs` | 608955 | `9f03f1e32002366296732eb1c61d23bb0b66d08d62ace7673b1528135797b8a7` |
| `tools/blocky-cli/dist/bin/blocky-project-io.exe` | 919552 | `dc891bc58934c9c7cfbcfd2c59cf18ef5e5c0a2af9506e7b06727cbcb2ea976f` |

真实大模型 API 调用：**否；未真实调用外部大模型 API**。临时新包位于 `D:\1Folder\Blocky-AI\try\accept-configure-*` 的本轮随机子目录，断言完成后核对绝对路径仍处于该前缀并清除；原先保留的 original.blocky 未改动。未写工作区外内容，仅本报告留下修改；未调用 GUI、未改实现或进展、未提交合并推送。此结论不是普通桌面最终包或阶段 1 总验收结论。
