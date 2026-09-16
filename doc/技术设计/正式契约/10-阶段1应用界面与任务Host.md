# 阶段 1 应用界面与任务 Host

本页补充已冻结契约的当前可执行配置。完整页面开发、任意终端及发布仍按后续阶段替换，不扩大权限。

## 应用界面

`app-surface.add` 消费 `manifest` 与声明的 `files`，缺任一字段拒绝；本阶段只接受一个锁定资料问答页面，源码与无依赖清单由 `packages/app-surface/src/sources.json` 注册，TS 与 Rust 共同校验。未知配置不降级为自由 HTML。旧读者必须拒绝不认识的操作。

显式用户命令生成补丁，`surface.preview` 与 `surface.invoke.ask` 分别显示并批准。普通 Agent 请求不能生成页面。项目包保存原始 HTML/CSS/JS/YAML 文本和结构化 JSON，均受声明路径和固定文件集合约束，非 JSON 文本不是二次 JSON 编码。

预览使用桌面 WebView 中不带 `allow-same-origin` 的 sandbox iframe；存储策略为完全禁止 Cookie/本地存储，任何项目间均不能共享。它没有独立预览服务、端口或 OS 进程，不以伪造资源计数证明回收。固定脚本受 SHA-256 CSP 限定，无网络及文件能力；Windows 实际隔离验证在 F 执行。

父窗口经 Host 校验文件与可见窗口后转交一次性 MessagePort。端口仅接受版本化 `ask` 请求，限定 4000 字符、单运行、30 秒期限、1000 次唯一请求；关闭标签关闭端口并取消该端口运行，保留页面产物。回答经当前项目的唯一关联入口进入共享 Runtime，返回答案与引用，不能传递 Tauri、项目内部状态或路径。打开标签与排序只在 WorkspaceSession 中，浏览器标签目标为 surfaceId。

CLI `surface create` 只输出候选补丁；`patch preview/apply` 使用与桌面相同的领域和 Rust 权威校验。应用含页面的项目时，源文件重查对 JSON 比较结构，对源码比较原始文本。

## 注册任务

`packages/terminal-protocol/src/project-check.json` 是唯一任务目录项，检查请求中的项目文件。TaskHost 使用当前程序固定 worker 模式，清空环境、固定 cwd 为程序目录，以 Windows Job 管理真实子进程。

请求仅允许次数、间隔、总时间和输出字节预算，任务并发为 1，终态历史最多 16 条。协作取消宽限 200 毫秒，超时与退出均等待真实子进程结束；输出持续排空，超过字节预算后保留计数。任务不是用户 PTY，不暴露 Shell/路径/环境/任意命令；所有 Agent 附加用户终端请求返回 `BLK-TERM-003`。

## 当前验证边界

19 项 CLI 测试含页面创建/拒绝/原生保存/源码篡改和原生任务成功/取消/超时/截断；49 项单元与 26 项契约通过（2026-09-16 19:42）。这不是普通窗口隔离、生命周期或最终验收结论。真实大模型 API 调用：否。
