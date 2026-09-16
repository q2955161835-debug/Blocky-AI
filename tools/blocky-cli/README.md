# Blocky CLI

与桌面端同步开发的命令行入口。当前使用同一 Project Model、Compiler、Runtime 和 Rust 项目存储；本地确定性适配器未真实调用外部大模型 API。

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

当前不提供 live、官方 Skills 安装、六个原生兼容模板或真实仓库扫描。候选补丁、应用界面命令随 D/E 的共享领域实现补充；帮助列表不会提前显示未实现操作。
