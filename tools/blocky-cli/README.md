# Blocky CLI

与桌面端同步开发的命令行入口。当前使用同一 Project Model、Compiler、Runtime 和 Rust 项目存储；本地确定性适配器未真实调用外部大模型 API。阶段 2 `0.2.0` 的 CLI/桌面共享入口已纳入 16/16 独立最终验收；普通候选绑定 `sourceCommit=f016afc19457bf5631ad5a41c3c686478a4dd080`，后续文档提交后的 HEAD 不替代该来源。

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
