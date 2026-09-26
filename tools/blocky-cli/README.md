# Blocky CLI

Agent 使用 Blocky 的核心入口，与桌面共享 Project Model、Compiler、Runtime 和 Rust 项目存储。常用任务通过结构化命令完成发现、编辑、审查、运行与恢复，不依赖电脑控制补齐业务能力。本地确定性模式不调用外部大模型；在线模式须使用 Host 预检与批准。

从仓库根构建：`pnpm build:cli`。运行 `./blocky.cmd --help` 查看**实际已实现**的命令。需 Node.js 22.12 或以上；依赖位于项目环境，不全局安装。

```powershell
.\blocky.cmd doctor --json
.\blocky.cmd catalog list --limit 10 --json
.\blocky.cmd project create --template research-companion --output .\try\my-project.blocky --json
.\blocky.cmd project validate .\try\my-project.blocky --json
.\blocky.cmd project compile .\try\my-project.blocky --json
.\blocky.cmd run preflight .\try\my-project.blocky --json
.\blocky.cmd run start .\try\my-project.blocky --simulate --input "为什么树叶变黄？" --jsonl
$LASTEXITCODE
```

创建目标的父目录必须已存在。文件已存在时退出码为 5，不提供强制覆盖开关。缺少存储程序返回 6；参数错误 2；校验失败 3；拒绝 live 运行 4；取消或超时 7；内部错误 10。`--timeout` 单位为毫秒，Agent 运行默认 120000，具名任务默认 30000；Ctrl+C 请求取消。机器脚本应直接调用 `blocky.cmd` 或 `node tools/blocky-cli/dist/main.mjs`，不要以 pnpm 包装进程的退出码代替 CLI 原始退出码。

`dist/` 包含入口脚本和 `bin/blocky-project-io.exe`，可整体移动到另一个目录运行；不依赖源码路径、不启动 WebView。源文件和工具协议不进入用户项目。

## 阶段 6–7 开发命令

### 独立资料目录

启动环境中的 `BLOCKY_PROFILE_DIR` 可指定绝对本地资料目录；桌面另支持 `Blocky Studio.exe --profile-dir <目录>`，参数优先于环境变量。用 `profile show --json` 读回 CLI 资料目录的稳定 `profileId` 和是否显式指定（`custom`）；输出不披露本机路径。路径无效、包含上级跳转、网络路径或目录链接时明确失败，不回落默认目录；`.env` 不自动加载此变量。

选定目录直接保存本资料集的设置、资源、秘密、日志、知识、转换缓存、记忆、恢复记录与自动化回执；桌面 WebView2 数据也进入其 `webview2/`。不同目录使用不同桌面实例标识，同目录保持单实例。项目文件与模型/驱动只读安装资产不迁移；新资料集不会自动复制原密钥或未保存作品。不设置时保留原默认行为。不要用覆盖 `LOCALAPPDATA` 代替桌面此入口：Windows Known Folder 不跟随该子进程变量。

`template list/show` 与欢迎页提供 `state-machine`、`behavior-tree`、`rule-engine`、`hybrid-router` 和 `event-mailbox` 架构起点。它们是可编辑的普通模块积木组合，不要求 Agent 根。状态机记忆和事件队列只保留在当前会话；退出程序或另开 CLI 运行不会保留。事件收件箱用普通输入入队，输入 next 按顺序取出消息。取出后业务失败不自动重投；持久工作流仍在开发。

`run start --inputs-file <inputs.json>` 可替代 `--input`，在同一会话按顺序执行 1–32 个字符串；每项最多 16000 UTF-8 字节，文件最多 128 KiB。用 `schema show blocky.run-inputs/v1 --json` 获取输入结构。失败、拒绝授权或取消后不继续剩余输入，整批共享命令超时；每次模型/工具请求仍遵守原有批准要求。JSONL 输出所有运行事件，最终 `runs` 分别返回结果和运行 ID，`completedInputs/requestedInputs` 表示进度。`--trace-output` 只导出最后一次尝试的运行，响应注明 `traceScope:last-run`；多次输入不能使用单个 `--output` 文件路径。

本节命令位于开发分支，尚未完成阶段交付。`run start` 可使用 `--breakpoint <module:block>`、`--debug-actions <actions.json>`（`step`、`continue`、`stop` 数组）、`--from-block <id>` 和 `--trace-output <trace.json>`；轨迹文件只保存受限元数据，`trace inspect/replay` 只读，不重发模型或工具调用。从所选积木运行若会跳过前置步骤，返回 `BLK-RUN-010`。

`project map <file.blocky> --json` 返回模块引用和影响范围；`project edit` 按 `blocky.editor-operation/v1` 批量编辑并保存新项目，要求当前项目摘要，源文件不覆盖。`rpa validate <plan.json>` 校验有人值守计划，`rpa recording-import` 产生 `requiresReview:true` 的待审阅草案并丢弃录入文本；草案不是可执行计划。Windows UIA 与隔离浏览器 Host 已有开发实现；普通包操作、录制和完整阶段门禁仍未完成。

阶段 4 已提供受控 `run start --live`；官方 Skills 安装和六个原生兼容模板尚未提供。阶段 3 已提供本地 Git 锁定提交扫描、静态证据与受限数值转换；不会执行上游代码。不能证明的函数/算法保留原生，兼容草案不能运行。`--fixture` 仅为旧夹具回归入口。`surface create`/`surface list` 提供候选页面清单路径，CLI 不打开浏览器或发布站点。

## 阶段 4 Agent 运行

`agent-loop` 是可编辑的文本分析项目示例，与四个官方知识蓝图分别列出。默认使用无网络模型，但本机工具仍需要批准。

```powershell
.\blocky.cmd project create --template agent-loop --output .\try\agent.blocky --json
.\blocky.cmd run preflight .\try\agent.blocky --json
.\blocky.cmd run start .\try\agent.blocky --simulate --input "Hello Blocky" --interactive --jsonl
```

在线生成先通过 `resource set` 配置用户模型、`secret import` 导入密钥引用，再将用户资源链接到项目并配置模型积木。`--live` 允许正式 Host 调用；是否真正联网由项目选中的模型决定，本地整理器不会因此变为远程模型。密钥不写入项目，也不作为命令行参数。

每次模型、工具和项目记忆操作都按完整请求摘要批准；`--interactive` 逐次询问，脚本可用 `--approval-file` 传入本次预检返回的 SHA-256 数组。固定 `--run-id` 只固定身份，不能复用已消费的批准。缺少批准退出 4，运行失败退出 3，取消退出 7。运行默认 `--timeout 120000` 毫秒，项目预算可进一步收紧；显式 `--output` 仅保存成功运行产生的单一文件工件，目标存在时拒绝覆盖。

JSONL 包含有序运行事件、稳定错误码、`modelApiCalled` 和实际模型用量；不能依据 `--live` 参数推断已调用外部 API。已验证的阶段 4 真实调用事实见[真实 Provider 验收](../../doc/验收/任务/阶段4证据/验收-2026-09-19-真实Provider与CLI.md)。

## 阶段 3 蓝图与真实来源

`template list` 列出 `research-companion`、`code-guide`、`knowledge-tutor`、`task-helper` 四个起点。三个知识起点的集合初始为空，先用 `knowledge add` 与 `knowledge sync` 导入资料；向量/混合模式需 `knowledge embed`。`run --simulate` 仍运行真实本地检索，只是不调用外部生成式模型。

```powershell
.\blocky.cmd template list --json
.\blocky.cmd blueprint official task-helper --output .\try\task-blueprint.json --json
.\blocky.cmd blueprint migrate .\try\old-blueprint.json --output .\try\migrated-blueprint.json --json
.\blocky.cmd blueprint update .\try\task.blocky --blueprint .\try\new-version.json --module research-agent --root research-root --output .\try\update.json --json
.\blocky.cmd patch preview .\try\task.blocky --patch .\try\update.json --json
```

更新有冲突时返回 `ready:false` 且不写补丁；明确 `--resolution keep-user` 或 `upstream` 后才生成候选。`blueprint restore` 生成还原补丁；`patch apply` 输出新项目，不覆盖原件。版本、绑定和默认副本随项目保存，蓝图本身不包含知识正文或模型密钥。

## 阶段 2 项目、模块、设置与资源

以下示例只使用本地临时路径、示例 ID 和无秘密的演示值；写入类命令都输出新文件或本机用户配置，不覆盖输入。完整参数以 `.\blocky.cmd --help` 的当前输出为准。

```powershell
# 旧项目显式迁移为新候选；原文件保持不变
.\blocky.cmd project migrate .\try\old-project.blocky --output .\try\migrated-project.blocky --json

# 项目模块：列出模块，或创建、重命名、删除并写入新项目
.\blocky.cmd project module list .\try\my-project.blocky --json
.\blocky.cmd project module create .\try\my-project.blocky --id notes --name "课堂笔记" --output .\try\with-notes.blocky --json
.\blocky.cmd project module rename .\try\with-notes.blocky --id notes --name "研究笔记" --output .\try\renamed.blocky --json
.\blocky.cmd project module delete .\try\renamed.blocky --id notes --output .\try\without-notes.blocky --json

# 项目设置与项目资源
.\blocky.cmd project settings list .\try\my-project.blocky --json
.\blocky.cmd project settings set .\try\my-project.blocky --id terminal.outputBudgetBytes --value 65536 --output .\try\with-setting.blocky --json
.\blocky.cmd project settings reset .\try\with-setting.blocky --id terminal.outputBudgetBytes --output .\try\reset-setting.blocky --json
.\blocky.cmd project resource list .\try\my-project.blocky --json
.\blocky.cmd project resource set .\try\my-project.blocky --definition .\try\example-resource.json --output .\try\with-resource.blocky --json
.\blocky.cmd project resource delete .\try\with-resource.blocky --id example-resource --output .\try\without-resource.blocky --json
.\blocky.cmd project resource references .\try\my-project.blocky --id example-resource --json
.\blocky.cmd project resource link-user .\try\my-project.blocky --id example-user-resource --output .\try\linked-resource.blocky --json
```

用户级配置写入本机用户存储。`settings` 的 `--value` 和 `shortcuts set` 的 `--keys` 接受 JSON；`resource set` 读取一个本地资源定义 JSON，示例文件内容不属于 CLI 固定字段。

```powershell
.\blocky.cmd settings list --json
.\blocky.cmd settings set --id ui.reduceMotion --value true --json
.\blocky.cmd settings reset --id ui.reduceMotion --json
.\blocky.cmd shortcuts list --json
.\blocky.cmd shortcuts set --id view.command-center --keys '["Ctrl+Alt+P"]' --json
.\blocky.cmd shortcuts reset --id view.command-center --json
.\blocky.cmd shortcuts export --output .\try\keys.json --json
.\blocky.cmd shortcuts import --input .\try\keys.json --json
.\blocky.cmd resource list --json
.\blocky.cmd resource set --definition .\try\example-resource.json --json
.\blocky.cmd resource delete --id example-user-resource --json
```

秘密命令只导入指定 `.env` 变量并返回配置状态，不打印秘密值；下面的文件、引用和变量名均为演示占位符。

```powershell
.\blocky.cmd secret import --id example-token --env-file .\try\example.env --variable BLOCKY_EXAMPLE_TOKEN --json
.\blocky.cmd secret status --id example-token --json
.\blocky.cmd secret remove --id example-token --json
```

## 蓝图与候选变更

```powershell
.\blocky.cmd blueprint create .\try\my-project.blocky --module research-agent --blocks research-root --name 课堂问答 --output .\try\classroom.json --json
.\blocky.cmd blueprint show .\try\classroom.json --json
.\blocky.cmd blueprint insert .\try\my-project.blocky --blueprint .\try\classroom.json --module research-agent --reuse-bindings --output .\try\inserted.blocky --json
.\blocky.cmd conversion scan .\try\my-project.blocky --fixture haystack-bm25 --module research-agent --resource product-handbook --output .\try\candidate.json --json
.\blocky.cmd patch preview .\try\my-project.blocky --patch .\try\candidate.json --json
.\blocky.cmd patch apply .\try\my-project.blocky --patch .\try\candidate.json --output .\try\converted.blocky --json
```

资源 ID 以 `project inspect` 结果为准。`--blocks` 使用逗号分隔的顶层积木 ID。插入时必须显式选择 `--reuse-bindings` 或提供 `--bindings` JSON 文件，格式为 `{ "resources": { "resource-slot-1": "目标资源ID" }, "modules": { "module-slot-1": "目标画布ID" } }`。预览列出结构、证据与新增权限；需要的权限须由调用者通过 `--approve-permissions` 单独批准。所有输出拒绝覆盖；过期补丁退出 5，校验或权限未批准退出 3，原输入文件保持不变。

转换只映射锁定 Haystack BM25 来源中的通用检索职责；不会迁移或运行其算法、DocumentStore、过滤与评分实现，也不代表完整兼容。依赖仅锁定上游声明文件，未安装解析。`dist/licenses/LICENSE.haystack` 随 CLI 分发保留 Apache-2.0 许可证。
# 修改配置

`blocky project configure input.blocky --module research-agent --block research-root --field ROLE --value 科学教师 --output revised.blocky --json` 使用与桌面相同的编辑函数，只允许积木目录声明的字段。输出为新项目，原文件不变；目标存在时退出 5。允许保存含编译诊断的编辑中项目，响应列出 diagnostics/warnings，运行仍按原门禁拒绝错误项目。

## 应用页面、任务与诊断

```powershell
.\blocky.cmd surface create .\try\my-project.blocky --module research-agent --output .\try\page-patch.json --json
.\blocky.cmd patch preview .\try\my-project.blocky --patch .\try\page-patch.json --json
.\blocky.cmd patch apply .\try\my-project.blocky --patch .\try\page-patch.json --approve-permissions surface.preview,surface.invoke.ask --output .\try\with-page.blocky --json
.\blocky.cmd surface list .\try\with-page.blocky --json
.\blocky.cmd task list --json
.\blocky.cmd task run .\try\my-project.blocky --task blocky.project-check --passes 5 --interval 100 --timeout 30000 --output-budget 65536 --json
.\blocky.cmd task run .\try\my-project.blocky --task blocky.project-inventory --limit 1000 --timeout 30000 --output-budget 65536 --json
.\blocky.cmd diagnostics export .\try\logs.json --channel runtime --output .\try\diagnostics.json --json
```

页面命令先生成可审阅候选，授权应用后才写入新项目；CLI 不打开浏览器或发布站点。具名任务执行真实受限 Rust 子进程，取消和超时等待结算，没有任意 Shell 或用户 PTY。诊断导出只保留时间、序号、级别、通道及合法丢弃计数，排除问题、答案、消息正文与属性；输出仍拒绝覆盖。以上阶段 2 历史模型结果来自确定性本地适配器，未真实调用外部大模型 API；阶段 4 的真实模型路径见前述运行说明。

## 阶段 5 构建助手与页面规格

构建命令只生成候选，明确接受仍使用 `patch apply`。默认本地模拟仅调整角色或解释选择，不调用外部模型；自然语言生成页面和修复需选择已配置在线模型。

```powershell
.\blocky.cmd builder inspect .\try\my-project.blocky --module research-agent --json
.\blocky.cmd builder draft .\try\my-project.blocky --module research-agent --prompt 植物教学助手 --output .\try\builder-candidate.json --json
.\blocky.cmd builder explain .\try\my-project.blocky --module research-agent --blocks research-root --prompt 解释所选 --output .\try\explanation.json --json
.\blocky.cmd builder verify .\try\my-project.blocky --candidate .\try\builder-candidate.json --json
.\blocky.cmd patch preview .\try\my-project.blocky --patch .\try\builder-candidate.json --json
.\blocky.cmd patch apply .\try\my-project.blocky --patch .\try\builder-candidate.json --output .\try\accepted.blocky --json
.\blocky.cmd surface create .\try\my-project.blocky --module research-agent --spec .\try\surface-spec.json --output .\try\surface-candidate.json --json
.\blocky.cmd surface build .\try\with-page.blocky --surface-id surface-example --output .\try\page.html --json
```

在线构建在 `builder draft/explain/repair` 增加 `--live --model <已配置资源ID> --request-id <唯一ID> --turns 4`。首次无 `--approve` 只返回预检；核对项目、模型、输入范围和预算后，以完全相同参数增加 `--approve <requestDigest>` 执行。批准一次使用，不自动重试；模型密钥仍由 Host 安全存储读取，不放命令行。需要页面时明确增加 `--surface`，模型建议不能代替授权。

`surface-spec.json` 使用 `blocky.surface-spec/v1`，字段及受控桥接见[契约 14](../../doc/技术设计/正式契约/14-阶段5构建助手与应用界面.md)。页面构建验证已接受源码并生成离线 HTML；不执行 npm 脚本，不发布。旧版未提供 `--spec` 的固定页面命令继续兼容。

`builder work <工作标识> <项目> --input <JSON> --output <JSON> --json` 支持 `build-blocky-agents`、`create-blocky-blocks`、`convert-github-project-to-blocky` 和 `reverse-agent-to-blocky`；前三者提供候选，逆向提供来源/保留项报告及可选候选。工作标识不代表已安装或发布官方 Skill，逆向不承诺完整框架兼容。

构建失败后可用 `builder evidence --request-id <id> --json` 查询 Host 最近一次调用记录。只保存安全的响应标识、实际模型、用量和稳定错误码，不保存提示词或模型正文；其他请求 ID 和不一致记录均拒绝。`networkAttempted` 只表示进入发送步骤，不能代替供应商响应证据。记录位于本机应用数据目录的 `builder-evidence/latest.json`，不写入项目。

息壤测试模型使用用户资源 `provider=xirang`、`implementationRef={"kind":"adapter","id":"xirang-v1"}`、`modelId=deepseek-v4-pro`。将本机 `.env` 中的 `XIRANG_API_KEY` 通过 `secret import` 导入独立 secretRef 后，用 `builder draft ... --live --model <resource-id>` 选择。预检返回的服务/模型及摘要需一起审核，修改 Provider 资源后旧批准不能继续使用。

## 有人值守 Windows 自动化

### 将计划加入普通模块

`rpa draft <项目> --plan <计划文件> --module <模块ID> --output <补丁文件> --json` 将计划转换为待审阅的普通积木；浏览器计划另传 `--browser-url`。随后用 `patch preview` 审阅、`patch apply` 接受权限变更并保存新项目。草案不运行自动化、不包含填充值，生成的新块 ID 可在补丁中查询。

模块用 `run start <项目> --live` 运行，并在每个步骤产生来源关联事件，支持已有断点、单步和停止。手动填写值用 `--rpa-inputs <JSON文件>` 传入，键为 `moduleId/blockId`；实际结构由 `schema show blocky.rpa-module-inputs/v1 --json` 发现。每项最多 16 KiB，文件仅保存本次需要的普通填写内容，不要保存密码或密钥；Host 仍逐次原生确认。`--simulate` 不启动真实 RPA。模块集成尚无普通包验收结论。

### 独立计划运行

```powershell
.\blocky.cmd rpa targets --json
.\blocky.cmd schema show blocky.rpa/v1 --json
.\blocky.cmd rpa validate .\try\automation.json --json
.\blocky.cmd rpa run .\try\automation.json --jsonl
.\blocky.cmd diagnostics explain BLK-RPA-LOCATOR-003 --json
```

Windows 目标 identity 必须来自当前 `rpa targets`；原生对话框要求核对计划与窗口。Windows UIA 与隔离浏览器均支持查找、读取、点击、填写与等待。截图已接入同一计划和权限，Windows 真实绘制及普通包仍待验。

浏览器高风险坐标回退仅允许 click：`locator:{"kind":"coordinate","x":50,"y":60,"riskAccepted":true}`。坐标从隔离浏览器可见页面左上角开始，使用 CSS 像素，当前视口 1100×760；不是桌面屏幕坐标。`rpa validate` 返回 `coordinateSpace` 和 `BLK-RPA-COORDINATE-RISK` 警告。运行时完整计划及每步均需原生确认；超界或视口变化拒绝，布局变化仍可能误点，应优先语义定位。转为普通积木时单独审阅 `rpa.coordinate` 权限。Windows 屏幕坐标目前拒绝执行。以上新增路径尚无普通包验收证明。

浏览器计划使用 `target.kind="browser"`，`target.identity` 为起始网址的来源（协议、域名及非默认端口，不含路径）。步骤定位器使用 `{kind:"browser",role:"button",name:"保存"}` 等可访问性角色及精确名称。运行方式：

```powershell
.\blocky.cmd rpa run .\try\browser-plan.json --browser-url https://example.test/form --project-id my-project --jsonl
.\blocky.cmd schema show blocky.rpa-browser-start/v1 --json
```

Host 原生确认全部计划和网址后才启动已安装的 Microsoft Edge，全新隔离会话不沿用个人 Cookie。仅允许初始来源，跨来源资源和 HTTP 重定向均拒绝；结束时回收会话。缺少 Edge 返回 BLK-RPA-BROWSER-MISSING，不自动安装。浏览器记录可以查询，但临时页面和登录状态不支持跨重启恢复。

填写步骤使用 `manual-input`，可增加 `--inputs <JSON文件>` 提供按 stepId 索引的临时填写值。敏感填写另声明 `value.sensitive:true`；每步原生确认目标、控件和用途，不展示正文。普通积木对应 `INPUT_KIND=sensitive`、`SOURCE=manual`，候选显示 `rpa.sensitive-input` 权限增量；默认普通用途，敏感读取与通用 SecretStore 引用仍拒绝。输入不会进入项目、日志和 checkpoint；调用者自己提供的输入文件由调用者妥善保管、用后移除，不应提交到 Git。

`--control-stdin` 启用逐行 JSON 控制，如 `{"operation":"pause"}`，其余操作为 `resume`、`stop`、`status`。SIGINT/SIGTERM 也请求停止并等待 Host 结算。`step.result` 是显式读取结果，`step.completed` 是无正文事件；最终响应包含读取结果与 checkpoint。`settled=false` 或 `uncertain` 不能当成已停止/已完成，禁止自动重放。

`rpa checkpoints` 查询加密执行记录，`rpa recovery-preview <id>` 显式读取恢复草案。Windows UIA 可使用 `rpa recover <原计划> --recovery <条件文件> --jsonl` 重新授权并核对完成副作用的目标状态，跳过已完成步骤；Schema 为 `blocky.rpa-recovery/v1`。未知结果、活跃旧进程、状态不符和浏览器临时会话均不能直接恢复。

查询返回 `settled`、`deletable` 和 `deleteBlockedCode`。选中可删除记录后，用 `rpa checkpoint-delete <id> --revision <当前修订号> --json` 显式删除；删除不可撤销，只移除执行回执，不改变目标应用。Host 重新核对全部条件，修订变化即拒绝。原执行进程必须已退出，且记录已结算、无未知副作用、不可申请恢复；旧格式没有结算证明时保留。不会自动清理记录。若请求中断或回执无法确认，请重新查询列表核对结果。

完整支持范围见[契约 15](../../doc/技术设计/正式契约/15-阶段6-7调试与有人值守自动化.md)。真实大模型 API 调用：否。

## Agent 生产力闭环

先发现真实接口和积木，再提交编辑。Schema 由实际运行时校验器导出；目录字段和 Host 语义检查仍会进一步约束输入。

```powershell
.\blocky.cmd command list --query patch --json
.\blocky.cmd schema list --json
.\blocky.cmd schema show blocky.cli-operations/v1 --json
.\blocky.cmd project block list .\try\my-project.blocky --module research-agent --limit 100 --json
.\blocky.cmd project block show .\try\my-project.blocky --module research-agent --block research-root --json
.\blocky.cmd project checkpoint .\try\my-project.blocky --output .\try\before-edit.blocky --json
.\blocky.cmd patch create .\try\my-project.blocky --operations .\try\edits.json --output .\try\batch-patch.json --json
.\blocky.cmd patch preview .\try\my-project.blocky --patch .\try\batch-patch.json --json
.\blocky.cmd patch apply .\try\my-project.blocky --patch .\try\batch-patch.json --output .\try\edited.blocky --json
.\blocky.cmd project diff .\try\before-edit.blocky .\try\edited.blocky --json
.\blocky.cmd project inspect .\try\edited.blocky --json
.\blocky.cmd project restore .\try\edited.blocky --checkpoint .\try\before-edit.blocky --expect-digest '<上一步的当前digest>' --output .\try\restored.blocky --json
.\blocky.cmd project compile .\try\restored.blocky --json
.\blocky.cmd diagnostics explain BLK-PATCH-002 --json
```

`edits.json` 是 1–500 项严格操作数组，例如：

```json
[
  {"op":"block.update","moduleId":"research-agent","blockId":"research-root","payload":{"fields":{"ROLE":"植物教师"}}},
  {"op":"block.move","moduleId":"research-agent","blockId":"research-root","payload":{"x":220,"y":140}}
]
```

批量操作按数组顺序生成一个候选事务，任一操作无效就不写候选；`patch create` 只验证并列出权限增量，不批准权限或修改项目。实际应用仍使用 `patch apply` 的 Host 复核和 `--approve-permissions`，过期候选不能应用。

积木列表返回稳定 ID、模块、父子/next/input/shadow 关系和字段，可按模块、类型或文本筛选。列表及项目差异使用 `nextCursor` 分页；传回 `--cursor`，不要把第一页当成全部结果。差异通过 JSON Pointer 定位项目事实，包含前后摘要；不同项目 ID 拒绝比较。

检查点仍是普通 `.blocky` 文件。恢复要求检查点与当前项目 ID 相同、当前摘要匹配，只写新的输出路径，不覆盖当前文件、不运行作品、不重放副作用。它恢复项目事实，不回滚用户资源、安全存储、知识索引或运行日志。编辑中项目的诊断会明确返回，运行门禁保持不变。所有新输出都拒绝覆盖已有目标。

### 自动化截图记录

计划中的 `screenshot` 动作使用唯一 UIA/浏览器语义定位，需审阅目标和 `rpa.capture` 权限。浏览器输入及可编辑区域（含溢出正文）会临时隐藏并遮盖；其他可见文字仍可能进入图片。图片按本机用户加密，单边不超过 2048、PNG 不超过 4 MiB，有效期为 24 小时，查询/保存时清理过期记录。最多 32 张/128 MiB，暂存按最大图片体积计入上限。运行结果与普通积木只返回带检查点/计划/步骤的 `blocky.rpa-capture/v1` 引用。

```powershell
.\blocky.cmd rpa captures --json
# 使用列表返回的 capture-id，选择新的输出文件
.\blocky.cmd rpa capture-export <capture-id> --output .\try\capture.png --json
.\blocky.cmd rpa capture-delete <capture-id> --json
.\blocky.cmd schema show blocky.rpa-capture/v1 --json
```

导出先核对图片摘要，既有文件拒绝覆盖；导出的 PNG 由调用者保留，不受内部有效期控制。删除仅作用于当前资料目录对应的图片记录。`BLK-RPA-CAPTURE-003` 表示尺寸/容量超限，`004` 表示过期，`005` 表示目标变化或无法可靠遮盖。截图/保留局部复核与普通包状态以任务验收为准。
