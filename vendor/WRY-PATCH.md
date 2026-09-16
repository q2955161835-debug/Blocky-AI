# Wry Windows 主帧脚本约束

- 来源：crates.io `wry 0.55.1` 发布工件，SHA-256 `186f9871daa55fd9c016578b810d149de58367113db7fb72b462d2323ce19514`。
- 上游仓库：https://github.com/tauri-apps/wry；工件自带 vcs 信息为 `a5bf203a1c8dbb3583588382538d6521655222a8`、dirty=true，以发布工件哈希为准，不把该 SHA 当完全相同源码证明。
- 许可证：保留 `wry/LICENSE-APACHE`、`wry/LICENSE-MIT` 和其他发布来源文件。
- 原因：Windows WebView2 的 AddScriptToExecuteOnDocumentCreated 会注入所有子帧；此版本 Windows 分支忽略 InitializationScript.for_main_frame_only。Blocky 原生预览负例实测子帧出现 Tauri 内部对象，不能满足产品隔离契约。
- 补丁仅在 `wry/src/webview2/mod.rs` 两处：为标记主帧专用的脚本添加 `window === window.top` 执行前置条件，并把 Wry IPC 引导对象限制在主帧。不是删除、遮盖已创建对象，也不关闭 CSP 或增加页面权限。
- Cargo 的项目级 `[patch.crates-io]` 使构建使用这份锁定源码；不修改用户 Cargo 缓存或系统依赖。约 0.84 MB 的完整发布源码为构建输入。
- 维护责任：后续升级 Wry 时先确认上游是否支持此约束，再执行普通/测试包主帧功能、sandbox 子帧对象和 IPC 负例；上游修复后移除此补丁。当前这是明确的第三方维护成本，禁止当作零技术债。
- 验证入口：`tests/e2e/studio.e2e.ts` 通过专用测试进程的 Playwright CDP 进入真实 opaque iframe，不用父窗口 DOM 访问模拟子帧。
