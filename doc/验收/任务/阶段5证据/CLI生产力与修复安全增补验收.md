# 阶段 5 CLI 生产力与修复安全增补验收

独立验收 Agent：stage5_xirang_security，未参与本轮实现。时间：2026-09-25 23:05 ~ 2026-09-25 23:08（Asia/Shanghai）。

本轮限定新增 CLI 查询、批量候选、差异、检查点恢复、错误反馈及失效资源修复权限边界，不做全仓审计。基线提交 `6d36db8185e7a8bad422cb2d8607f20c5de58fcc`，分支 `codex/feat-stage5-builder-surfaces`；当前未提交源码和实际受测 CLI/Host 文件的 SHA-256 见[源码及构建快照](CLI生产力与修复安全源码哈希.json)。不替代普通候选、GUI、真实供应商或阶段最终验收。

真实大模型 API 调用：**否**。仅使用公开合成夹具和本机原生存储；未读取凭据、未外发、未操作 GUI。

## 汇总表格

| 用户功能 | 使用场景 / 等级 | 结果 | 证据 |
|---|---|---|---|
| 修复失效资源 | 原基线不凭空取得能力，结果必须严格，新增能力仍须批准 / L3 | 通过 | 独立模型修复负例：漏批准、伪造 delta、结果仍失效均被真实 Host 拒绝；合法明确批准与 TS 结果一致 |
| 批量创建候选 | 中途失败、敏感输入、已有输出 / L3 | 通过 | 合法第一项加三类非法第二项均无候选写入；源字节不变；已有输出哨兵及临时文件结算通过 |
| 查询命令及 Schema | 实际导出、未知与原型名称、敏感错误 / L2 | 通过 | 真实构建 CLI 全部 5 个 Schema 可导出；500 项上限与严格对象约束存在；stdout/stderr 不回显敏感哨兵 |
| 恢复检查点 | 跨项目、旧摘要、输出路径别名、取消 / L3 | 通过 | 跨项目与旧摘要拒绝；hardlink 别名不覆盖；预取消无输出；源文件不变 |
| 保留编辑中的项目 | 诊断可恢复但不启动执行、不继承批准 / L3 | 通过 | 同项目诊断检查点可保存到新文件并给出 warning；digest 相等；代码路径只编译和保存，运行批准仍由新运行参数建立 |

最终结论：**通过**，仅限上述增量范围。本轮未发现需实现方修复的安全缺陷。

## 详细报告

### 用户功能：修复积木引用

#### 场景：修复失效模型不会绕过权限增量

对 starter 的模型资源加入合成 `fixture.extra.model` 能力，再将 compose 积木改为不存在的模型引用。独立探针通过真实 makePatch 生成修复，确认新增能力出现在 permissionDelta；真实原生 validatePatch 在未批准时返回 `BLK-PATCH-003`，即使 approved 包含该能力、但伪造 permissionDelta 为空仍拒绝。明确批准合法 delta 后，Host 结果与 TS preview.next 完全一致。把修复结果重新改成不存在的引用时 Host 返回 `BLK-PATCH-002`。

源码核对：allow_unresolved 只用于原项目权限集合，未声明引用不会贡献能力；新项目调用 false，继续执行 project_files、patch_links、真实资源范围/类型/secretRefs 核对和 after-minus-before 与声明/批准集合比对。TS 模型分支只在原基线根本未声明匹配模型引用时跳过解析。此次不把这项修复外推为任意损坏存档均可修复；已声明但定义损坏的资源仍可能被拒绝。

### 用户功能：批量编辑和错误反馈

#### 场景：批次失败不留下半个候选或泄露输入

三轮独立批次均先包含一个合法角色修改，再加入秘密形状字符串、shell.execute/额外 command 字段、错误模块之一。全部失败，输出不存在，原项目字节不变。公开返回错误经过 failure 封装，未包含合成敏感正文。合法批次遇到已有候选路径时返回 `BLK-CLI-005`，原哨兵内容不变且目录没有遗留 .tmp。

patch.create 只生成候选，TS preview 与 Host validate 结果必须 canonical 相同；向 validatePatch 传候选 delta 是候选可行性校验，不写原项目、不执行能力。真正 patch.apply 仍使用既有批准参数与 Host 写入路径，新增命令没有绕过它。

#### 场景：代理查询真实 Schema 和安全错误

独立调用实际 `tools/blocky-cli/dist/main.mjs`，schema list 返回五个 ID，逐个 schema show 均得到可用 JSON Schema。源路由另验证 `blocky.cli-operations/v1` 为最多 500 项且包含 additionalProperties=false。未知名称、__proto__、constructor 均拒绝；真实 CLI 对含敏感哨兵的未知错误码退出 2，stdout/stderr 均不回显哨兵。

命令表来自当前 help，Schema 映射引用实际 builderOperationSchema、builderRequestSchema、draftInputSchema、surfaceSpecSchema 和 workspaceBlockShape，不另维护宽松接受器。错误建议为固定字典，未知异常仍经统一 generic failure 投影。差异路径使用 JSON Pointer 转义、100000 访问节点及100层上限，分页只投影已读取项目内容；没有新文件执行器或网络调用。

### 用户功能：检查点与恢复

#### 场景：恢复不覆盖或混淆当前项目

独立动态验证跨 projectId 的检查点拒绝、错误 expect-digest 拒绝且无输出；以源文件 hardlink 作为目标也拒绝，两个路径字节不变；预取消不创建目标。原生 createArchive 仍验证存档字段，写同目录临时文件、flush/sync 后 persist_noclobber，CLI 工件也以同目录 hardlink 发布，均不覆盖已有路径。

检查点恢复允许保留编辑诊断：将同项目的失效模型项目作为检查点后，恢复产生新文件并显示 warning，保存项目 digest 与检查点一致。这里的恢复语义是用户显式保存指定已有作品，不声称重新执行语义补丁审批；它不恢复运行批准、调用账本、活动请求或执行副作用。源码只调用 readProject、compileProject、createProject。后续 runAgent 从空 approved 集合开始，只有新命令的 approval-file/interactive 输入能填入请求摘要，nativeAgentServices/Host 仍执行原有运行授权。

源摘要在保存前重新读取；本轮未对恶意同用户进程在最后一次读回与发布之间实施竞态注入。新文件不覆盖源文件这一边界已动态验证，不把它外推为跨进程事务锁或系统级攻击防护。

## 验证命令与产物

`pnpm exec vitest run --config try/stage5/cli-security/vitest.config.ts`：退出 0，最终 1 文件、6/6，通过；23:07:11 开始，5.41 秒。探针直接调用实际领域/CLI dispatcher、真实原生 helper，并调用真实构建 CLI 进程；没有 mock 掉 Host 校验。未重复主 Agent 的 CLI 全套或完整门禁。

探针和日志位于 `try/stage5/cli-security/`：probe.test.ts、vitest.config.ts、probe.log 及公开合成 fixture 目录，共 48341 字节。测试执行中没有新建 Rust target。未修改产品、未提交/合并/push；测试只使用当前工作区及已安装工具，没有主动新增工作区外数据。

错误汇报：自动审批审查拒绝删除本轮 fixture-* 临时夹具的命令，仅返回 `blocked by policy`，未给更具体原因。该删除没有执行，夹具完整保留，交由主任务统一整理；不影响验证结果。测试命令本身无失败。

后续受检源码或构建文件变化时，需要按差异局部补验；本报告不替代发行包敏感扫描和最终交付验收。
