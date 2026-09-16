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

创建目标的父目录必须已存在。文件已存在时退出码为 5，不提供强制覆盖开关。缺少存储程序返回 6；参数错误 2；校验失败 3；拒绝 live 运行 4；取消或超时 7；内部错误 10。`--timeout` 单位为毫秒，默认 30000；Ctrl+C 请求取消。机器脚本应直接调用 `blocky.cmd` 或 `node tools/blocky-cli/dist/main.mjs`，不要以 pnpm 包装进程的退出码代替 CLI 原始退出码。

`dist/` 包含入口脚本和 `bin/blocky-project-io.exe`，可整体移动到另一个目录运行；不依赖源码路径、不启动 WebView。源文件和工具协议不进入用户项目。

当前不提供 live、官方 Skills 安装、六个原生兼容模板或任意仓库扫描。转换消费随包附带的锁定源码，不下载或执行上游代码。`surface create`/`surface list` 已提供候选页面清单路径，但 CLI 不打开浏览器或发布站点。

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

页面命令先生成可审阅候选，授权应用后才写入新项目；CLI 不打开浏览器或发布站点。具名任务执行真实受限 Rust 子进程，取消和超时等待结算，没有任意 Shell 或用户 PTY。诊断导出只保留时间、序号、级别、通道及合法丢弃计数，排除问题、答案、消息正文与属性；输出仍拒绝覆盖。所有本阶段模型结果来自确定性本地适配器，未真实调用外部大模型 API。
