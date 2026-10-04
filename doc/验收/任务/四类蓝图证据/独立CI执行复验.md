# 四类蓝图 Windows CI 执行局部复验

验收等级：L2。独立角色：blueprints_final_acceptance（sol / medium，未参与本次修复）。本次只检查测试运行器并发及直接受影响的真实子进程测试，不重复B01–B08功能验收或Full，不改实现。

## 汇总表格

| 用户功能 | 使用场景 | 验证结果 |
|---|---|---|
| 自动验证 | 小CPU运行器执行全部packages测试 | 通过：after双核预检与535项前后覆盖一致，529通过/0失败/6显式跳过 |
| 真实进程协议 | 三个新Node会话进程与coding/builder两个stdin协议 | 通过：断言及超时未改，after原三项均实际通过 |
| 普通包来源 | CI配置修正是否改变已交付产品 | 通过：直接diff仅vitest.config.ts，不改变产品实现或包来源 |
| 本地标准检查 | pnpm check完整回执 | 通过：typecheck、unit529、contracts32、deployment35，根退出0 |
| 远端集成 | 最终整合后的Windows CI | 未执行：尚未取得新远端成功；旧37177896422为真实失败 |

## 详细报告

### 自动验证

#### 场景：受限CPU仍执行原全部测试

本地时间段：2026-10-04 13:13 ~ 2026-10-04 13:16。局部工作分支`codex/fix-four-blueprints-ci`。独立读diff，唯一执行配置变化是引入Node `availableParallelism()`，将固定`maxWorkers:8`改为`max(1,min(8,floor(availableParallelism()/2)))`。include/exclude、全局10000ms timeout均不变；并发最多8且至少1，不减少测试数或跳过慢测试。

原main`00ef96c6d4912cb6340b6c52f6751e90b0e815e6`的[Windows CI37177896422](https://github.com/I-dont-know-codex-is-right/Blocky-AI/actions/runs/37177896422)在pnpm check失败，coding/builder真实stdin各10000ms超时，session-state实际子进程status null。后续组件、Host、CLI及知识质量步骤被跳过，不能称旧CI通过。原日志/JSON在`try/待清理/四类蓝图-2026-10-04/integration-ci-first-failure.*`。

双核baseline原JSON独立核读535总、528通过、1失败、6pending，失败为session真实进程status null（20538.415ms）。`two-core-before-startup.json`是主Agent从实际exec输出补留的启动/观察记录：PID98632启动及后续CPU4.19秒观察均affinity3；没有before availableParallelism预检，不把此记录称为新测量，也不声称baseline全部tsx禁缓存。session测试自身明确`TSX_DISABLE_CACHE=1`。

after实际stdout预检`available=2/workers=1/tsxCacheDisabled=true`；完整JSON success=true，535总、529通过、0失败、6pending。独立对比前后所有测试fullName零差异。该结果支持受限并发改善当前资源竞争，但不单凭本地结果宣称远端已修好。证据`two-core-after.stdout.log`、`two-core-after.json`、诊断启动脚本`two-core-check.mjs`。

### 真实进程协议

#### 场景：真实跨进程会话和双schema分派保留

独立读session-state测试源，三次真正`spawnSync(process.execPath,tsx fixture)`及20秒子进程超时、exit0、回传结果/递增sequence/无模型调用断言都未改。coding-worker测试仍为coding和builder各真实`spawn`、stdio管道输入/输出、exit0、complete内容、每帧对应schema及finally清理，不改为Mock。

after原三项：coding 2063.3996ms、builder 2051.515ms、session三进程6830.0137ms，均passed。独立Git diff确认上述两个测试文件无变化。本次无真实模型API调用。

### 普通包来源

#### 场景：已交付功能不被CI修正污染

当前直接改动仅Vitest配置与进展文档，未触及产品实现、依赖锁或原普通包。既有稳定包`dist/Blocky-Studio-0.8.0-blueprints/`仍绑定`10e738b2ec695693627ec02b1a0cec3ba37531ab`的功能/Full360/30/全文件及自然退出证据；本次配置复验不冒称重建或重新执行B01–B08。

## 问题与风险

2026-10-04 13:17补充核读：`ci-fix-check-result.json`记录实际pnpm check退出0、输出chunk b6f582；原始`ci-fix-check.log`完整链为typecheck→unit→contracts→deployment，unit529通过/6跳过、contracts32通过、deployment35通过/1跳过，无失败。局部阶段要求已齐。

旧远端失败保留；本地baseline CPU设置记录及缓存边界明确。新远端集成是本轮局部阶段之后的独立交付核读，尚未执行，不签其成功。

## 最终结论

通过

本轮局部阶段范围为并发配置、测试覆盖与原真实进程断言不减、双核全packages及本地pnpm check、产品实现未改；该范围全部通过。最终整合后须追加实际新远端CI结论，当前仍未执行。此局部通过不撤销旧CI失败或冒称新远端成功。
