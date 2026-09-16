# 阶段 1 D 补丁、转换与 CLI 安全独立局部验收

## 汇总表格

| 项目 | 内容 |
|---|---|
| 执行人 | 独立安全验收 Agent `accept_stage1_b`；未参与实现 |
| 本地时间段 | 2026-09-16 18:58 ~ 2026-09-16 19:00 |
| 精确提交 | `51753b092c41112f145c5c7a8267eb641cbe3197` |
| 范围 | builder-protocol、conversion-core、CLI artifacts/construction；直接复核 ProjectController 与既有 Rust 存储信任边界 |
| 等级 | L3；S1-06 候选与补丁安全、S1-12 对应 CLI |
| 正式聚焦测试 | 领域 4/4；CLI 2/2，另 12 项按筛选未执行 |
| 独立探针 | 10 组观测；7 组正向保护通过，3 组异常观测归并为下方 2 个问题 |
| 真实大模型 API 调用 | **否；未真实调用外部大模型 API** |
| 最终结论 | **不通过** |

| 编号 / 场景 | 结果 | 影响 |
|---|---|---|
| D-SEC-01 候选携带秘密 | 不通过，P1 | 任意 diagnostics 对象中的 apiKey 原值经 CLI preview stdout 暴露；block.add 扩展字段中的 token 进入预览结果 |
| D-SEC-02 Host 基线/权限复核 | 不通过，P1 | 冻结契约要求的 Host 重验未发生；仅传最终 files 可落盘新增能力，无 patch/base/approval 证据 |
| 权限差异独立批准 | 领域层通过 | 无批准拒绝；伪造空 permissionDelta 即使给足批准仍拒绝；正确差异与批准可接受 |
| 原子事务与并发 | 领域/文件原子层通过 | 后续非法操作、异步预览时并发编辑、过期基线拒绝；原内容不被部分覆盖 |
| CLI 新文件/no-clobber | 通过 | 项目与 JSON 工件目标存在时拒绝、哈希不变、临时文件清理 |
| 来源锁定与保留边界 | 通过 | 修改内容并重算哈希、篡改许可证、未知快照字段均拒绝；声明保留 BM25 实现与未安装依赖 |

## 详细报告

### 1. 审阅不可信候选

#### D-SEC-01：凭据可进入预览和 stdout

构造一个正常 ROLE 更新补丁，只把其 diagnostics 改为包含虚构 apiKey 的对象。`parsePatch` 接受，因为 diagnostics 是 `z.array(z.unknown())`。CLI `patch preview` 返回 0，输出的 patch.diagnostics 包含原始虚构凭据值；正常 diagnostics 重编译并没有去掉嵌入返回 patch 内的攻击者诊断。

第二个领域反例给合法 block.add 的 extraState 加虚构 token。payload 为 z.unknown，Project Schema 透传 extraState，projectWithOperations 只检查 fields 是否在目录内；previewPatch 成功，next 中保留该虚构值。这条数据已经进入预览/前端领域，后续 Rust 保存才拒绝不能修复此前泄漏。

独立探针结果：

- `untrusted-diagnostic-secret`：CLI code=0，leaked=true。
- `untrusted-block-secret`：previewAccepted=true，secretInNext=true。

全程只用明确虚构凭据，不读取本机真实秘密。CLI output 对字符串做模式脱敏，但没有按凭据字段名处理其值，因此无法拦住无模式的键值型凭据。建议在补丁入口验证 Diagnostic 正式结构、约束/检查 block payload 的可保留扩展数据，并确保任何诊断/预览分发前执行结构化凭据处理。不能仅增加 UI 遮罩或依赖最终保存时扫描。

#### 未知字段与版本

补丁顶层额外字段、操作顶层额外字段、未知 catalogVersion 的独立反例均被拒绝。此结果不意味着 diagnostics 和 payload 的内部结构已严格验证，后者正是 D-SEC-01。

### 2. 接受补丁与安全持久化

#### 2.1 领域层权限与事务

独立配置一个尚未启用知识调用的项目，资源要求 private.read；新增检索块后 permissionDelta 正确包含新增能力。无批准 applyPatch 拒绝 BLK-PATCH-003；将 permissionDelta 伪造为空，给足批准也仍拒绝。正确差异与单独批准可完成事务。

补丁预览过程中并发修改项目显示名，提交时拒绝 BLK-PATCH-001，保留并发编辑而不套用旧补丁。两操作补丁的后一个操作无效时，整个 ProjectController 项目摘要不变。正式测试另外覆盖一次撤销、过期 patch 重复使用拒绝和预览不修改输入。

#### D-SEC-02：Host 未参与补丁基线与能力复核

冻结契约 `doc/技术设计/正式契约/04-构建补丁命令设置与资源-v1alpha1.md` 第 5、39 行明确要求用户接受后 Host 重验基线和能力，再原子应用。

当前桌面 accept 只调用前端 applyPatch；CLI 同样在 TypeScript ProjectController 中应用，再将 encodeProject 后的最终 files 交给原生 create。Rust 请求只接收 schemaVersion/operation/path/files；既有桌面 save 同样只接收 files/handle。Host 没有基线摘要、补丁、能力差异或批准凭据可以重验。

实证：同一 private.read 新增能力补丁不批准时被 TypeScript 拒绝。取其 preview.next，直接调用当前已打包 native companion 的 create，以最终 files 为输入、不给 patch/base/approval，返回退出 0、ok=true 并写出有效包。

这不是“缺少某个指定名字的 API”形式问题，而是实际权威边界缺少重新校验。可通过专用端点或等价的可信事务机制修复；仅文档声明“后续保存用同一 Rust”不能满足冻结要求。建议可信 Host 接收当前项目身份/基线及受约束补丁，重算能力差异并核验单独批准，返回可验证事务结果；过期、未批准和写入失败都不能改变原项目。

影响限定：本轮没有证明 Runtime 实际执行了未授权 private.read，也没有执行网络、任意 Shell 或文件读取能力；现有 Runtime 能力检查不因本报告被否定。问题是补丁接受与持久化的 Host 权威校验缺口，不能由另一层运行拒绝抵消。

### 3. 文件失败保护

当前 CLI patch.apply 从 source.blocky 生成新 applied.blocky，随后重复同一路径退出 5；输出文件哈希和源文件哈希均保持。JSON artifact 首次写入后再次写同名，拒绝且哈希不变；完成后目录中无 .tmp 遗留。正式 CLI 源码候选测试验证 scan/preview 不修改源，apply 新目标成功，旧候选套到已修改目标时退出 5。

这些结果证明新文件发布和失败不覆盖，不等于 Host 已重验补丁授权。领域先改内存后持久化在当前 CLI 进程失败时不会改原源包，但桌面内存接受缺少 Host 校验仍属于 D-SEC-02。

### 4. 锁定源码与许可证

validateSnapshot 限定 repository/commit/version/license、恰好三个文件及硬编码受信哈希。独立修改某文件内容后重新生成攻击者哈希仍拒绝；许可证改为 MIT 和快照未知字段均返回 BLK-CONVERT-001。正常候选输出 source 绑定 commit、路径/行号/哈希，依赖 resolution 为 declarations-only、installed=false，retained 明确列出未转换 BM25 算法/过滤/打分，且不执行上游代码。

本轮验证的是已有锁定本地夹具的内部完整性和保留声明，没有重新联网审计上游整仓许可证或宣称原生完整兼容。无真实网络模型请求或依赖安装。

## 命令、工件与限制

| 命令 | 退出码 | 结果 |
|---|---:|---|
| `pnpm exec vitest run packages/builder-protocol/tests/patch.test.ts packages/conversion-core/tests/conversion.test.ts` | 0 | 4/4 |
| `pnpm exec vitest run tests/cli/commands.test.ts -t 'creates a real archive\|reviews a locked source'` | 0 | 2/2；其余 12 项跳过 |
| `node --import tsx try/accept-stage1-d-security/probe.mts` | 0 | 观测驱动运行完毕，results.json 记录 2 个安全缺陷；驱动 0 不表示全部通过 |

| 当前工件 | 字节数 | SHA-256 |
|---|---:|---|
| `tools/blocky-cli/dist/main.mjs` | 669841 | `dcaea269d1b61deae313176eafeb588624030dd2b05f2d099453b58eec414c7b` |
| `tools/blocky-cli/dist/bin/blocky-project-io.exe` | 919552 | `dc891bc58934c9c7cfbcfd2c59cf18ef5e5c0a2af9506e7b06727cbcb2ea976f` |

报告结束时目标实现相对该提交无 diff。没有 GUI、蓝图普通组件全盘、A/B/C 全套重复或最终普通 Windows 包验收。真正的阶段 1 总验收仍未执行。

探针和虚构数据包保留在 `D:\1Folder\Blocky-AI\try\accept-stage1-d-security`，8 文件共 16,758 字节，供修复复验；未更改实现。没有主动工作区外读写，没有提交、合并或推送。初次检索使用 Windows 通配路径及一个不存在的测试文件名而退出 1，随后改为实际目录和 commands.test.ts，未把该检索错误当产品问题。真实大模型 API 调用：**否；未真实调用外部大模型 API**。

## 复验一：026a227 的两项安全修复

本地时间段：2026-09-16 19:09 ~ 2026-09-16 19:11。目标提交：`026a22717342d60034a454c56ed3f86516b50ff6`；执行时 HEAD 为 `372c2ab5341b0fa538c68286326691c90eec9a9c`，目标 D 修复范围相对 026a227 无 diff。没有把后续 E 的实现列入验收。

### 汇总表格

| 项目 | 复验结论 |
|---|---|
| D-SEC-01 原 diagnostics 凭据反例 | 通过；领域拒绝 BLK-PATCH-002，CLI preview 退出 3，stdout 无原虚构凭据 |
| D-SEC-01 block.add.extraState 凭据 | 通过；TypeScript 与新 native validate-patch 均拒绝 |
| D-SEC-02 Host 端口与生产接入 | 已补齐；桌面两个 apply 路径必经 validatePatch，CLI validate/apply 分别调用 native guard；不再用普通 create 发布 Builder 补丁 |
| Host 基线/权限差异 | 通过；无批准、伪造 permissionDelta、错误 baseDigest 均独立拒绝；合法批准通过 |
| Host 文件原子与源重验 | 通过；apply-patch 重读不一致源拒绝，无新文件；重复目标 no-clobber 拒绝，源/目标哈希不变 |
| Host 语义拒绝等价性 | 不通过；未知 EXPORT 和非法 STYLE 被 TypeScript 拒绝，却被 native validate-patch 返回 ok=true |
| 当前限定结论 | **不通过**；D-SEC-01 关闭，D-SEC-02 剩余语义复核缺口 |

### 详细报告

当前 Host 已独立应用操作、核验原 JSON 摘要、共享目录字段、重算激活资源能力，并在 CLI 落盘前再次执行 guard、重读源文件和 no-clobber。通过原本具备文件权限的普通 create 导入项目，不再用来推断 Builder 专用路径仍绕过；初验观察应结合本次明确分开的调用边界理解。

剩余问题是此次可信 guard 的直接语义差异：

1. 将 call-citation 的 EXPORT 更新为 does-not-exist。previewPatch 拒绝；native validate-patch 对同原始项目和同补丁返回退出 0、ok=true。
2. 将 reply-answer 的 STYLE 更新为 unsupported-style。previewPatch 拒绝；native validate-patch 同样退出 0、ok=true。

共享 definitions.json 只含字段名，Rust block_shape 未实现该枚举约束，且 patch_guard 未复核跨模块导出引用。冻结契约要求引用校验与原子应用后重编译；新可信边界不能将 TypeScript 已认定无效的语义补丁标为合法。需在 Host 中补齐等价引用/字段值检查或用明确可信的共享语义校验端口完成，而非单纯字段存在性。此残项不声称已运行非法能力或泄漏真实数据。

### 执行证据

| 命令 | 结果 |
|---|---|
| `pnpm exec vitest run packages/builder-protocol/tests/patch.test.ts` | 退出 0；4/4 |
| `pnpm exec vitest run tests/cli/commands.test.ts -t 'independent native patch gate'` | 退出 0；1/1，其余 14 项未执行 |
| 内联 `node --import tsx --input-type=module` 原漏洞复现 | 原 diagnostics 拒绝且不泄漏；未知 EXPORT / STYLE 两项 hostAccepted=true |
| 内联 native guard 独立断言 | 退出 0；无批准/伪造差异/错误基线拒绝、正常批准、源重读、原子冲突和两层 extraState 拒绝均通过 |

保留一个安全重验输出包 `D:\1Folder\Blocky-AI\try\accept-stage1-d-security\recheck-native.blocky`，其余被拒绝目标未产生。未改源码、未用 GUI、未跑全盘、无工作区外主动读写。真实大模型 API 调用：**否；未真实调用外部大模型 API**。
