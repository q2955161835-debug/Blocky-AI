# 任务验收：Blocky 专业生产力工作台

状态：已完成并归档

验收等级：L3（原生文件权限、本地数据、核心文档与运行流程）

验收对象：`e00022cdfcc29133cf14535d04e8c9be924a8250`

对应设计：[Blocky 专业生产力工作区设计（第二版）](../../../产品设计/Blocky-现代桌面工作区设计.md)

## 一、汇总

| 编号 | 验收场景 | 等级 | 独立结果 |
|---|---|---|---|
| A1 | 真实文档生命周期与原生文件安全 | L3 | 通过 |
| A2 | 命令中心、菜单、快捷键与状态真实性 | L2 | 通过 |
| A3 | 积木拖入、画布双模式、滚轮缩放与防重叠 | L3 | 通过 |
| A4 | 对话即运行与可理解的执行过程 | L3 | 通过 |
| A5 | 产品化清理、布局与可访问性 | L2 | 通过 |
| A6 | 原生回归、安全隔离与交付门禁 | L3 | 通过 |

涉及模块：桌面壳、命令系统、DocumentSession、Blockly 编辑器、积木库、原生 Host、`.blocky` 项目容器、运行时投影、对话测试、测试与安全门禁。

独立验收由未参与实现的子 Agent 在工作区干净状态执行；结论为 A1–A6 全部通过，Critical（严重）0、Important（重要）0、Minor（次要）1。

最终结论：**通过**。

## 二、可复核门禁

| 检查 | 执行者 | 结果 |
|---|---|---|
| `pnpm --dir .\try\windows-core-spike check` | 独立验收 | 退出码 0；128 个 unit、49 个 component、31 个普通 Rust 测试、普通 Web 构建、fmt/clippy、四目标敏感扫描通过 |
| `cargo test --manifest-path .\try\windows-core-spike\src-tauri\Cargo.toml --locked --features wdio` | 独立验收 | 退出码 0；WDIO feature 测试 9 个、project store 测试 23 个通过 |
| `pnpm --dir .\try\windows-core-spike check:core` | 实现 Agent | 退出码 0，272.7 秒；单元/组件/Rust、原生 E2E、三项性能、普通 release、隔离与扫描全部通过 |
| `git diff --check afe17c6..e00022c` | 独立验收 | 退出码 0 |

普通 Windows release：

- 文件：`try/windows-core-spike/src-tauri/target/release/windows-core-spike.exe`
- 字节数：`12,414,464`
- SHA-256：`72017D48705265C2BFB9B89B2148C3286A853C0A0E85BAC5C636C181CA1A65A7`
- 普通前端 `withGlobalTauri=false`；普通 Cargo tree 无 WDIO/WebDriver；普通包中的测试命令、测试全局与固定夹具名标记均为 0。
- capability 只有 `main`；窗口权限保持最小化、最大化/还原、关闭和拖动标题栏四项。

性能中位数：载入 `18.7 ms`、运行 `0.1 ms`、保存编译 `0.4 ms`。四目标敏感扫描为 `tracked=0 snapshot=0 frontend_log=0 backend_log=0`。

本任务较早的完整门禁已通过未缩短的 `360/360` 个 5 秒循环、30 次真实 Rust Host 保存/重载，耗时 `1,803,154 ms`，heap delta `1,173,772` 字节。最终证据扩展只增加测试 feature 下的固定文档对话夹具、交互监听覆盖、窗口关闭保护与错误呈现，没有修改事件上限、Host 保存循环、WebView 生命周期或长期运行状态，因此最终提交按计划复跑 `check:core`，未重复执行 `check:full`。

## 三、详细结果

### A1 真实文档生命周期与原生文件安全

原生 E2E 覆盖文件菜单与 `Ctrl+N`、`Ctrl+O`、`Ctrl+S`、`Ctrl+Shift+S`，并验证对话框取消、`.blocky` 保存/重开、dirty 保护、保存失败和原生窗口关闭。非法 ZIP、路径穿越、错误格式版本、派生数据不一致均失败关闭且保留当前文档；其余容器负例由 Rust 集成测试覆盖。前端不能传入任意本机路径，也不显示原生完整路径。

### A2 命令中心、菜单、快捷键与状态真实性

文件、编辑、视图和帮助菜单，命令中心与快捷键读取同一命令注册表。直线撤销/重做箭头、启用状态、搜索结果、文档标题及 `未保存 / 正在保存… / 已保存 / 保存失败` 状态均由真实会话状态驱动。

### A3 积木拖入、画布双模式、滚轮缩放与防重叠

原生 E2E 覆盖积木单击/拖入、选择/平移、框选、Shift 多选、`Ctrl+A`、Escape、Delete、复制粘贴、撤销重做、画布滚轮缩放、侧栏滚动和 Space 临时平移。100 块夹具与左右栏收纳保持画布变换、积木尺寸和连接，顶层积木不存在持久重叠。

Tauri WebView 的 W3C pointer device action 未稳定分发到页面监听器，验收改用 WebView 内构造的 `PointerEvent` / `WheelEvent` 驱动同一套真实产品监听器；没有增加生产旁路或仅为验收成立的交互实现。

### A4 对话即运行与可理解的执行过程

聊天输入 Enter 直接运行，显示用户消息、流式助手回复、唯一终态与默认折叠的执行过程；普通界面没有独立“运行”按钮。权限批准/拒绝、取消、失败、再次发送与文档切换保持 run token 和投影修订隔离，内部事件 JSON、blockId、IR/schema 版本不向用户显示。

### A5 产品化清理、布局与可访问性

普通界面已移除“Windows Core”“技术尖峰”“载入 100 块”、原生 Blockly 垃圾桶和重复工具栏。独立验收复核 1440×900 与 1180×720 的 125% DPI 原生窗口，像素截图分别为 1800×1125 与 1475×900；核心控件均在边界内。键盘可遍历菜单、搜索、编辑、右栏标签和聊天输入，标签支持 Enter/Space 激活。

视觉证据：

- [展开态](../../../技术设计/Windows-Core视觉验收/11-professional-workbench-expanded.png)
- [折叠态](../../../技术设计/Windows-Core视觉验收/12-professional-workbench-collapsed.png)
- [对话结果](../../../技术设计/Windows-Core视觉验收/13-professional-conversation-trace.png)
- [1440×900](../../../技术设计/Windows-Core视觉验收/15-professional-workbench-1440x900.png)
- [1180×720，125% DPI](../../../技术设计/Windows-Core视觉验收/16-professional-workbench-1180x720-high-dpi.png)

### A6 原生回归、安全隔离与交付门禁

最终普通 release、Rust、原生 E2E、性能、敏感扫描和 WDIO 隔离均通过。受控原生文档夹具严格受 `wdio` feature 限制，只接受固定枚举，不接受前端路径；普通 release 不包含相关命令。未发现重复业务实现、并行文档状态源或未解释的临时生产补丁。

## 四、问题、风险与未执行项

- Critical：0。
- Important：0。
- Minor：1。Vite 提示生产 Web JavaScript bundle 约 `1.08 MB`；当前尖峰本地离线启动与性能门禁通过，不阻塞本次功能验收，正式产品拆包时应治理。
- 未执行项：最终提交没有重复执行 30 分钟 `check:full`；原因和已有完整门禁证据见“可复核门禁”，对应长期状态触发条件均未命中。
- 工作区外写入：依赖解析使用 `C:\Users\29551\.cargo` 的正常 Cargo 缓存；WDIO 固定文档夹具由 Rust `tempfile::TempDir` 在系统临时目录创建并自动清理。未在外部位置保存项目数据或敏感值。

本报告只绑定上述精确实现提交的事实；后续文档归档或合并提交不改变该技术证据。
