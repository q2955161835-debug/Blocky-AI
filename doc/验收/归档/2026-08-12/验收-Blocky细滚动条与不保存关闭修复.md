# Blocky 细滚动条与不保存关闭修复验收

## 汇总

| 项目 | 内容 |
|---|---|
| 任务 | 缩细 Blockly 画布横向/纵向滚动条，并修复未保存文档点击“不保存”后应用不关闭的问题 |
| 涉及模块 | Blockly 画布样式、桌面窗口关闭桥、Tauri 权限、原生 E2E、普通发布包隔离 |
| 验收等级 | L3（原生关闭属于核心文档生命周期；需要确认不会误保存、误关闭或把测试能力带入发布包） |
| 实现证据提交 | `2d1142386e34444c7501e2b2cccea10208225bf4`，文档澄清提交 `98daa65` |
| 验证结果 | 实现方完整 Core 门禁与独立原生验收均通过 |
| 问题风险 | 普通 Web 构建约 1.08 MB 的既有 bundle 警告仍为 Minor；本次未触发长稳复跑条件 |
| 最终结论 | 通过 |

## 详细报告

### 1. “不保存”关闭原生窗口

验证步骤：

1. 在原生 Tauri 应用中创建未保存更改。
2. 触发系统窗口关闭并在保护对话框点击“不保存”。
3. 使用仅在 `wdio` feature 下注册的隐藏哨兵窗口保留驱动会话。
4. 断言窗口句柄只剩 `wdio-close-sentinel`，生产 `main` 窗口已消失。

预期结果：不写入未保存内容，主窗口被销毁，应用可正常结束；取消仍保留窗口。

验证结果：通过。关闭桥调用 `Window.destroy()`，生产 capability 精确授予 `core:window:allow-destroy`；独立原生 E2E 为 1 spec / 1 passing。

### 2. 细滚动条与画布可用性

验证步骤：

1. 在同时出现横向和纵向滚动条的 100 块画布检查可见滑块。
2. 读取可见滑块尺寸、圆角和透明度，并检查 Blockly 交互轨道尺寸。
3. 检查 100 块布局、三个顶层积木和画布控件是否重叠。
4. 对照用户提供的滚动条截图与最新原生截图。

预期结果：横向和纵向可见滑块均为 6 px、圆角 3 px、默认透明度 0.62；至少 15 px 的原生交互轨道不缩小；积木不重叠。

验证结果：通过。组件断言、原生断言和视觉证据一致；更新后的 `11-professional-workbench-expanded.png` 与 `15-professional-workbench-1440x900.png` 已人工复核。

### 3. 普通发布包隔离与权限最小化

验证步骤：

1. 在 `wdio` feature 下构建并运行原生 E2E。
2. 随后执行普通 `tauri build --no-bundle` 恢复发布产物。
3. 检查普通 Cargo 依赖树、前端 `dist` 和 EXE 中的 WDIO、sentinel 与测试钩子标记。
4. 检查主 capability 只保留真实使用的窗口权限。

预期结果：测试哨兵不进入普通发布包；普通能力不包含无用 `allow-close`。

验证结果：通过。普通 Cargo tree 的 WDIO 命中为 0，`dist` 与 EXE 的 WDIO/sentinel/test marker 命中均为 0；主 capability 为 default、minimize、toggle-maximize、destroy、start-dragging。

### 4. 自动化与独立验收证据

实现方命令：

```powershell
pnpm --dir .\try\windows-core-spike check:core
```

结果：exit 0，约 286 秒；128 unit、50 component、31 普通 Rust 测试、原生 E2E、性能、普通 release、fmt/clippy、四目标敏感扫描均通过。敏感扫描结果为 tracked 0、snapshot 0、frontend log 0、backend log 0。

独立验收命令：

```powershell
pnpm --dir .\try\windows-core-spike check
cargo test --manifest-path .\try\windows-core-spike\src-tauri\Cargo.toml --locked --features wdio
pnpm --dir .\try\windows-core-spike test:e2e:build
pnpm --dir .\try\windows-core-spike test:e2e
pnpm --dir .\try\windows-core-spike tauri build --no-bundle
```

结果：全部 exit 0。快速门禁为 128 unit、50 component、31 普通 Rust 测试；feature 测试共 32；原生 E2E 为 1 spec / 1 passing。独立验收恢复的普通 EXE 为 12,414,464 字节，SHA-256 为 `EBA339CD7F79A1241B627B52BB571E6D31677A43D3A936E7B237FEC08F0EC5B4`。`git diff --check` 通过，Critical 0、Important 0、Minor 0。

## 未执行项与风险

- 未重新执行约 30 分钟的 `check:full`。本次没有更改事件上限、保存循环、Host 持久化、WebView 生命周期或长期状态；完整 Core、真实原生关闭和普通发布构建足以覆盖本次影响面。
- 普通 Web bundle 体积警告是已记录的既有 Minor，本次未扩大其范围。
- EXE 构建哈希不作为可复现构建承诺；最终根目录交付副本在合并后重新构建、复制并单独校验。

## 最终结论

本次 L3 验收通过。未保存文档点击“不保存”后生产主窗口可被真实销毁；滚动条视觉厚度降低且交互轨道保持；普通发布包未包含 WDIO 或测试哨兵。
