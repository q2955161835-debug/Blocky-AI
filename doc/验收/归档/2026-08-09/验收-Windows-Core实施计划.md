# 验收：Windows Core 技术尖峰实施计划

## 汇总

| 项目 | 内容 |
|---|---|
| 涉及模块 | Windows Core 技术尖峰范围、Blockly 编辑器、稳定 IR、InteractionManifest、Tool 契约、确定性运行时、Tauri Host、原生 E2E、性能/稳定性/安全门禁、Git 收口 |
| 验收等级 | L1（实施计划与验收设计，不包含应用代码或运行结果） |
| 验证结果 | 计划包含 0–12 共 13 个可独立审查任务、79 个勾选步骤、31 个唯一尖峰积木 ID，并将 ADR-001 八项 Core 门禁逐项映射到自动与人工证据 |
| 问题风险 | 当前只证明计划可执行性和规格覆盖；依赖兼容、WebView 性能、原子写入、WDIO 原生通道和 30 分钟稳定性必须在执行计划后以真实结果验收 |
| 最终结论 | 通过 |

## 详细报告

### 1. 范围与产品事实一致性

验证步骤：

1. 对照 `ADR-001-首版跨端技术选型.md` 第一阶段八项门禁。
2. 对照 `Blocky-交互入口与工具积木设计.md` 中右侧双标签、无入口禁用、能力解锁、多入口草稿和一等 Tool 规则。
3. 对照 `Blocky-积木完整清单.md` 的六类连接语法和稳定积木 ID。
4. 检查是否把临时尖峰与正式产品、完整 311-ID 积木目录和商业功能明确分开。

预期结果：计划只验证 Windows Core 架构风险，不擅自扩张到正式产品、账号/订阅、真实模型、CLI/Skills、社区、macOS、移动端或原生 Agent 适配器。

结果：通过。计划明确将 `搭建助手` 限定为静态说明；`运行 Agent` 只由 `InteractionManifest` 驱动，入口积木内部不含发送框。

### 2. 任务结构与接口一致性

验证方法：解析计划标题、任务、勾选步骤、接口段和代码围栏，并人工检查前后任务使用的类型与函数名称。

验证结果：

- 任务：13 个，编号 0–12 连续。
- 勾选步骤：79 个。
- 每个任务均列出精确文件和 `Consumes`/`Produces` 接口。
- 全局冻结 `JsonValue`、`BlockyProgram`、`InteractionManifest`、`ToolContract`、`SpikeProjectSnapshot`、`ProjectRecord` 与 `RuntimeEvent`。
- 31 个尖峰积木 ID 全部唯一；明确其只是验证子集，不替代完整 311-ID 产品清单。
- 每个实现阶段包含失败测试、最小实现、通过测试和提交门槛；最终包含 L3 验收、计划归档、快进合并与分支清理。

结果：通过。

### 3. Core 门禁与证据闭环

逐项检查结果：

| Core 要求 | 计划证据 |
|---|---|
| Blockly 安装包本地加载 | release 构建、断网原生 E2E、构建 URL 扫描 |
| 100 积木编辑与保存 | 精确 100 夹具、序列化单测、真实 Host 保存/重开、人工拖连折叠缩放 |
| 稳定 IR 与画布回映 | 视觉字段无关确定性测试、source map、运行事件与高亮 E2E |
| 双标签与无入口禁用 | React 组件测试、原生 E2E、人工删除最后入口 |
| Manifest 能力同步 | 零/单/多入口、重命名/重排、六能力、草稿保留组件与 E2E |
| Tool 契约共用 | 对象身份、参数迁移、显式调用与 Agent 附着测试 |
| 流式/取消/错误/权限 | 确定性运行时单测和原生交互路径 |
| 项目/日志敏感扫描为零 | TypeScript 扫描、Rust Host 拒绝、跟踪文件/快照/前后端日志总扫描 |

结果：通过计划验收。表中项目均为未来必须执行的验收，不代表当前已经运行通过。

### 4. 权限、测试与发布边界

验证步骤：

1. 检查普通 Tauri 配置是否默认 `withGlobalTauri: false` 且只有 `core:default`。
2. 检查 WDIO Rust 插件、前端插件、全局测试钩子和 `wdio:default` 是否只在单独 feature/mode/capability 中启用。
3. 检查 Rust Host 是否只接受受限项目 ID 和 JSON，而非任意路径。
4. 检查计划是否禁止自动推送 GitHub、发布或把尖峰称为产品。

预期结果：测试能力不能进入普通 release；Host 不扩大文件权限；本轮不发生外部发布。

结果：通过。

### 5. 文档和静态验证

验证命令与方法：

```powershell
pwsh -NoProfile -File .\scripts\check-dev-environment.ps1 -Json
git diff --check
```

另以只读 PowerShell 检查计划必需头部、任务编号、步骤数、代码围栏、31-ID 唯一性、ADR 八项关键词、禁止占位词、相对 Markdown 链接和常见敏感模式。

预期结果：环境 26/26；所有结构计数符合；无破损围栏、未定义占位、失效相对链接、疑似真实秘密或 Git 空白错误。

结果：通过。具体终检输出在本阶段提交前重新运行并以退出码为准。

### 6. 未执行项与剩余风险

- 未创建 `try/windows-core-spike/` 应用代码，未安装计划中的项目依赖。
- 未运行 Blockly、React、Rust、Tauri、WebdriverIO 或 30 分钟 soak 测试。
- 性能阈值是尖峰验收门槛，尚无本机实测数据；不得在结果不理想时无记录放宽。
- `atomic-write-file`、Tauri/WDIO feature 隔离和 WebView heap 指标仍需真实编译与原生运行验证。
- 计划通过不授权 GitHub push、发布、支付接入或正式产品脚手架生成。

## 最终结论

Windows Core 技术尖峰实施计划满足 L1 文档验收，可作为下一轮代码实施依据。只有执行计划并取得 L3 `通过` 后，才能把 Windows Core 架构标记为已验证。
