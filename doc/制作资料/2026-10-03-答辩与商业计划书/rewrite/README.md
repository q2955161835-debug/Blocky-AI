# 小学 Agent 创作教育材料制作入口

当前主线为产品研发：现有Windows成果 → 六专业模板 → 后续产品建设 → 准备关口 → 真实场景与条件商业化。小学创作沿用读懂、改造、自主搭建和调试解释；不写团队介绍。个人开源与社区、组织后台、独立算力、多端和Agent App均按建设阶段呈现。

## 当前输入

- build-investor-ppt.cjs：45页连续PPT，按研发资产、模板关口、未来场景、持续业务和阶段资金完整讲述；保留可编辑文字与表格。
- speaker-notes-v3.json：45页公开讲稿、来源与转场，沿用文件名；讲述时间仅作参考。
- business-plan-v2.json：5.0版、24页独立BP；六张财务表读取funding-summary.json。
- sync-financial-narrative.py：从原生Excel缓存摘要更新BP关键金额、阶段支出、样本和公开成本参照；稳定标签支持再次同步。
- build-business-plan.py：只读技能Word模板生成黑白A4文档，当前原生Word输出显式使用宋体。
- refresh-toc.py：从实际PDF标题位置更新TOC缓存和页数统计，保留可更新字段；--page-stats-only仅同步实测页数。
- check-word-cjk.py：执行11项Word标准检查及宋体核对；仅豁免用户指定的专名DeepSeek Harness，普通harness措辞仍检查。
- sanitize-package.py：清理插件、路径元数据与失效包引用，修复重复对象ID；截图仅按显式标记裁切，重排不依赖旧页码。
- export-ppt.ps1：独立PowerPoint实例只读打开候选、原生导出PDF并关闭本次实例。
- export-business-plan.ps1：当前使用-Engine Word导出24页BP；仅关闭本次实例。保留可用时选择LibreOffice的入口。
- investor-revision-research.md：2026-10-03官方Scratch、BBAI、Tynker、教育部和算力产品研究，明确各页面支持的范围。
- check-example.ts、story-*.json：本地Runtime条件对照，不代表完整故事生成或真实课堂。

## 生成与检查

先按[新资金模型](../funding-24m/README.md)生成、原生重算和审计工作簿，再提取共享摘要。所有新输出先进入项目try。

```powershell
node doc/制作资料/2026-10-03-答辩与商业计划书/rewrite/build-investor-ppt.cjs
python doc/制作资料/2026-10-03-答辩与商业计划书/rewrite/sanitize-package.py try/rd-narrative-20261003/presentation/Blocky-Studio-小学Agent创作教育-2026-10-03.pptx
& doc/制作资料/2026-10-03-答辩与商业计划书/rewrite/export-ppt.ps1 -Path try/rd-narrative-20261003/presentation/Blocky-Studio-小学Agent创作教育-2026-10-03.pptx
```

使用已配置Node/Python运行时及PptxGenJS；模块通过NODE_PATH解析。Word生成器使用--template指定只读技能模板、--content指定本目录business-plan-v2.json、--finance指定../funding-24m/funding-summary.json、--font宋体、--output指定try下DOCX。已有候选需显式--overwrite。

DOCX导出PDF后，使用refresh-toc.py传入DOCX和对应PDF，再次原生导出并核对全部页、目录起页和嵌入字体。本次PDF仅嵌入SimSun，采用宋体是明确的中文排版选择，不能只看DOCX字体标签就推断PDF字体。最终五文件都要绑定新哈希；清理XLSX不得改变工作表、样式、共享文本与计算链。

## 历史与边界

旧试点、35页/3.0版与37页/4.0版资料可通过Git恢复。旧投资顾问及24个月预算通过只绑定旧哈希，本轮以[研发主线与真实算力独立验收](../../../验收/任务/验收-2026-10-03-研发主线与真实算力依据.md)为入口。

本次材料任务不实施产品源码、实际开源发布、机构后台或计费系统，不新增ImageGen或Blocky外部模型请求。历史模型响应只属于原合成资料产品演示，教学效果、真实用户、合同和融资不由预算推导。后续产品开发以[完整开发计划](../../../执行计划/2026-08-23-Blocky-竞品驱动完整开发计划.md)为入口。
