# 阶段 2 固定交付证据

实现提交：`f016afc19457bf5631ad5a41c3c686478a4dd080`。后续文档与忽略规则收尾不改变此候选的产品源码。

正式结论以[独立最终验收](../验收-2026-09-17-Blocky阶段2.md)、[独立安全分项](../验收-2026-09-17-Blocky阶段2安全分项.md)为准。本目录保存被核对的副本及来源，不额外生成验收结论。真实大模型 API 调用：否。

| 证据 | 内容 |
|---|---|
| [开发验证来源](development-check-provenance.json) | unit 127、contract 27、component 17、Rust 26+1、CLI 24、原生 E2E 5；原始与规范化日志哈希 |
| [Full 来源](full-provenance.json) | Core/Full 4 项退出 0；360 个五秒循环、30 次原生保存重开；二进制哈希 |
| [Full 结果](full-f016afc.json) | 1,803,382 ms，堆差 -8,703,892 字节，无错误、外发请求或受信输入 |
| [发行清单](release-package-f016afc.json) | 8 文件、19,112,686 字节及逐文件 SHA-256 |
| [普通包扫描](release-scan-f016afc.json) | 普通包隔离与测试正控制 |
| [独立发行读回](security-release-readback-f016afc.json) | 独立哈希及明确模式扫描 |
| [许可证覆盖](license-coverage-f016afc.json) | 315/315，缺失 0 |
| [四目标补证](privacy-four-target-f016afc.json) | 当前 tracked、项目/IR、前端日志、原生持久日志的限定样本和已知 canary 检查 |
| [中间产物映射](storage-moves-final.json) | 36 项、20,166 文件、8,351,259,352 字节的可逆整理 |

开发验证是各组成命令的真实执行结果，没有额外宣称根 `check:core` 或 `check:full` 别名重新运行。初轮未完成的 Full 不算通过，保留于 `try/待清理/stage2-initial-soak/`。

普通产品目录为 `dist/Blocky-Studio-0.2.0/`，不包含本目录、验收材料或内部规则。普通 EXE 为 12,500,480 字节，SHA-256：

```text
319d3110119010b1295cbeecb4bb11d6f4d0d28837ae684239dc47651312f915
```

临时脚本、构建缓存和原始日志已移动至 `try/待清理/阶段2-2026-09-17/`；原报告中的 `try/stage2-*` 和构建路径是执行时来源，整理后按映射查找。已有安全探针二进制与未完成初轮分别保留在 `try/待清理/stage2-security-native-probe/`（51,862,016 字节）和 `try/待清理/stage2-initial-soak/`（25,216 字节）。未删除内容；按映射反向移动可恢复构建缓存。发行物、根 CLI 入口和用户项目未移动。
