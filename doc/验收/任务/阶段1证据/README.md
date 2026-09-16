# 阶段 1 精选执行证据

本目录是内部验收材料，不进入 `dist/Blocky-Studio-0.1.0/`。正式验收结论见[任务报告](../验收-2026-09-16-Blocky阶段1正式Demo.md)，本索引只说明文件来源。

| 文件 | 来源与边界 |
|---|---|
| Full.json / cycles.jsonl | 2026-09-16 20:42–21:12 `scripts/check-native-core.ps1 full` 的原始报告；360循环、30次真实原生重开；测试包哈希记录在报告中。没有鼠标键盘输入，不代替普通窗口验收。 |
| performance.json | 同一 runId 的100积木/100执行节点性能；一次预热后五次样本，含设备/分辨率/DPI。 |
| release-artifacts.json | d8a521f105cb3cfee6730c5b3d7c7a7cedea05eb 上普通二进制、CLI与前端7个文件的扫描；仅检查列明模式与已知路径，不是通用秘密检测证明。 |
| package.json | 发行目录8个文件的字节数/SHA-256；目录含桌面、CLI、使用说明、第三方许可证与selectors源码。 |
| packaged-cli-independent.json | 最终独立 Agent 从仓库外目录运行交付 CLI，检查创建/编译/模拟运行、冲突退出5和原文件哈希保护。 |
| license-coverage.json | 锁定JavaScript/Rust依赖313项许可证收集结果；来源补充记录在vendor/licenses/registry.json。 |
| shutdown-experiment-not-passed.json | 20:39生命周期实验的系统读回，WDIO最终退出1；此文件不能证明普通退出验收通过。 |
| storage-moves.json | 收尾时22个构建/中间产物位置的原路径、新路径、字节数与文件数；这是整理清单，不是删除记录。 |

Full 对应核心源提交 `83be3fed4b80cc647bf684feee84253be33cb44d`；其后的发行提交只改变构建/打包/许可证/CLI启动器测试及文档，没有改变该运行核心。普通包与测试包是不同二进制，不互相替代通过结论。真实大模型 API 调用：否。

普通界面、画布手势、原生对话框、托盘/关闭的最终检查依用户指令暂缓。根聚合 `pnpm check:core` / `pnpm check:full` 和远端 CI 本轮未完整执行。

原始 `try/stage1-*`、`try/accept-stage1-*` 和构建缓存现已移至 `try/待清理/阶段1-2026-09-16/`，本目录精选文件保留原字节，历史报告中的原始路径按 storage-moves.json 定位。可运行候选仍在 `dist/Blocky-Studio-0.1.0/`，根 CLI 所需 `tools/blocky-cli/dist/` 继续保留。重新构建可再生成测试和普通缓存，不需要恢复旧缓存。
