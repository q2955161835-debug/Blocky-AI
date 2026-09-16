# Blocky 正式契约索引

| 项目 | 内容 |
|---|---|
| 契约代际 | `v1alpha1` |
| 冻结阶段 | 阶段 0 |
| 首个代码消费者 | 阶段 1 Demo 正式 monorepo 最小纵切 |
| 稳定性 | 可实现候选；阶段 2 稳定前允许显式迁移，不允许静默改义 |

本目录是 Blocky 正式产品接口的唯一阶段 0 索引。它定义不同包、Host、桌面界面和未来 CLI 之间交换什么数据，不代表对应产品功能已经实现。`try/windows-core-spike/` 只提供验证证据，不是正式契约或包边界。

## 1. 事实优先级

同一事项冲突时依次服从：

1. 用户当前明确指令；
2. [竞品驱动完整开发计划](../../执行计划/2026-08-23-Blocky-竞品驱动完整开发计划.md)；
3. [ADR-005](../ADR-005-多模块应用界面与RPA边界.md)、[ADR-006](../ADR-006-底部面板终端与日志系统边界.md)及其专项产品设计；
4. 设置中心、积木语言、兼容模板和 CLI/Skills 产品设计；
5. Windows Core 尖峰及归档验收证据。

发现冲突时必须修订当前基线或记录明确决策点，不能用未验证实现反向覆盖产品契约。

## 2. Schema 注册表

| Schema 标识 | 负责对象 | 正文 | 存储边界 | 派生 | 首个消费者 |
|---|---|---|---|---|---|
| `blocky.project/v1alpha1` | Project Manifest 与模块索引 | [项目、模块与会话](01-项目模块与会话-v1alpha1.md) | 项目 | 否 | `project-model` |
| `blocky.workspace-session/v1alpha1` | 标签、底部面板与视图会话 | [项目、模块与会话](01-项目模块与会话-v1alpha1.md) | 本机用户会话 | 否 | `studio-desktop` |
| `blocky.module-ir/v1alpha1` | 单模块 IR 与 source map | [IR、链接与诊断](02-IR链接与诊断-v1alpha1.md) | 缓存/内存 | 是 | `compiler` |
| `blocky.project-ir/v1alpha1` | 跨模块链接结果 | [IR、链接与诊断](02-IR链接与诊断-v1alpha1.md) | 缓存/内存 | 是 | `runtime-core` |
| `blocky.diagnostic/v1alpha1` | 编译、配置、权限与迁移诊断 | [IR、链接与诊断](02-IR链接与诊断-v1alpha1.md) | 会话/诊断存储 | 是 | `ui-editor` |
| `blocky.interaction/v1alpha1` | Agent 运行入口 | [交互、工具与运行](03-交互工具运行与可观察性-v1alpha1.md) | 缓存/内存 | 是 | `ui-runtime` |
| `blocky.tool/v1alpha1` | Tool 类型、权限与实现引用 | [交互、工具与运行](03-交互工具运行与可观察性-v1alpha1.md) | 项目引用/注册表 | 部分 | `runtime-core` |
| `blocky.event/v1alpha1` | 运行时事实事件 | [交互、工具与运行](03-交互工具运行与可观察性-v1alpha1.md) | 有界运行存储 | 是 | `runtime-observability` |
| `blocky.resource/v1alpha1` | 模型、知识、记忆、工具、Skill、MCP、护栏与任务资源 | [构建、命令、设置与资源](04-构建补丁命令设置与资源-v1alpha1.md) | 项目/本机资源注册表 | 否 | `resource-registry` |
| `blocky.build/v1alpha1` | Blocky 构建助手需求计划 | [构建、命令、设置与资源](04-构建补丁命令设置与资源-v1alpha1.md) | 审阅会话 | 否 | `builder-protocol` |
| `blocky.patch/v1alpha1` | 可审查语义补丁 | [构建、命令、设置与资源](04-构建补丁命令设置与资源-v1alpha1.md) | 审阅会话 | 否 | `builder-protocol` |
| `blocky.command/v1alpha1` | 菜单、命令中心、快捷键与上下文菜单 | [构建、命令、设置与资源](04-构建补丁命令设置与资源-v1alpha1.md) | 应用资源 | 否 | `command-system` |
| `blocky.setting/v1alpha1` | 应用、项目、资源与积木设置 | [构建、命令、设置与资源](04-构建补丁命令设置与资源-v1alpha1.md) | 按作用域分离 | 否 | `settings-schema` |
| `blocky.app-surface/v1alpha1` | 用户显式创建的应用界面 | [应用界面、RPA 与窗口](05-应用界面RPA与窗口-v1alpha1.md) | 项目 | 否 | `app-surface` |
| `blocky.frontend-bridge/v1alpha1` | 应用界面最小桥接 | [应用界面、RPA 与窗口](05-应用界面RPA与窗口-v1alpha1.md) | 项目 | 否 | `app-surface` |
| `blocky.rpa/v1alpha1` | 有人值守 RPA 应用、定位、权限与检查点 | [应用界面、RPA 与窗口](05-应用界面RPA与窗口-v1alpha1.md) | 项目/运行存储 | 部分 | `rpa-runtime` |
| `blocky.window/v1alpha1` | 窗口、通知区域、单实例与退出结算 | [应用界面、RPA 与窗口](05-应用界面RPA与窗口-v1alpha1.md) | 本机应用状态 | 否 | `studio-host` |
| `blocky.log/v1alpha1` | 结构化组件、终端与预览日志 | [底部面板、终端、日志与审计](06-底部面板终端日志与审计-v1alpha1.md) | 有界本机日志存储 | 是 | `observability` |
| `blocky.terminal/v1alpha1` | 用户终端会话与 Agent 进程隔离 | [底部面板、终端、日志与审计](06-底部面板终端日志与审计-v1alpha1.md) | 本机会话 | 否 | `terminal-protocol` |
| `blocky.task/v1alpha1` | 项目具名任务 | [底部面板、终端、日志与审计](06-底部面板终端日志与审计-v1alpha1.md) | 项目/扩展资源 | 否 | `terminal-protocol` |
| `blocky.audit/v1alpha1` | 高风险授权与外部副作用审计元数据 | [底部面板、终端、日志与审计](06-底部面板终端日志与审计-v1alpha1.md) | 有界本机审计存储 | 是 | `observability` |

## 3. 唯一数据流

阶段 1 新增注册（2026-09-16 用户授权同步 CLI）：`blocky.cli/v1` 和 `blocky.project-io/v1alpha1`，定义与消费者见 [CLI 与项目存储协议](08-CLI与项目存储协议.md)。不改变上述阶段 0 冻结 Schema。

```text
Project Manifest + per-module Blockly Workspace JSON
                       ↓ compile
            ModuleIR + source map + Diagnostic
                       ↓ link
                    ProjectIR
                       ↓ project
       InteractionManifest + ToolContract
                       ↓ run
                  RuntimeEvent
          ┌────────────┼────────────┐
          ↓            ↓            ↓
      画布高亮      运行日志      运行轨迹

Compiler / Runtime / Builder / Host / Terminal / Preview / RPA
                       ↓ structured record
        Normalize → redact → bounded event bus
          ┌────────────┼────────────┐
          ↓            ↓            ↓
         问题          输出       诊断/审计存储
```

禁止 UI 解析普通文本日志来推断运行状态、权限决定或项目语义。磁盘中的 IR、清单、诊断与日志不是可信项目事实；项目加载后重新编译声明式来源并比较摘要。

## 4. 契约变更规则

1. 修改 `v1alpha1` 必须同时更新正文、受影响正反夹具、[阶段 1 接口交接](07-阶段1-Demo接口交接.md)、受影响的 U 场景、迁移说明和消费者列表。
2. 字段改名、语义改变、枚举收窄或默认行为改变属于破坏性变更，阶段 1 开始后必须新增 Schema 版本或提供显式迁移。
3. 新字段必须声明必需性、默认行为、未知读取器行为、存储位置和敏感性。
4. 新错误必须使用稳定代码；显示文案可以国际化，代码与来源不得改变。
5. 正夹具证明可消费形状，负夹具证明拒绝边界；不能只写描述而没有可机器读取证据。
6. 项目、夹具、日志和文档只允许秘密引用，不保存凭据值或私有访问地址。

## 5. 阶段 1 入口

阶段 1 在正式 monorepo 中为每个契约建立最小实现或确定性适配器，并按[阶段 1 接口交接](07-阶段1-Demo接口交接.md)完成 U01–U07、U15、U16、U18、U19。固定内容通过正式接口注入；产品项目、事件、设置与 UI 不增加临时 Demo 标识或专用分支。

阶段 1 实现前必须读取本索引、全部契约正文、正反夹具和替换账本；不得从尖峰复制包结构或建立第二套项目格式。

夹具目录固定为：

- `fixtures/valid/`：多模块项目、确定性运行、显式应用界面、有人值守 RPA、窗口与终端生命周期。
- `fixtures/invalid/`：缺失导出、隐式应用界面、Agent 附加用户终端、无人值守 RPA、未脱敏日志。

夹具是正式接口的长期回归输入，不代表相应真实服务已经实现。
