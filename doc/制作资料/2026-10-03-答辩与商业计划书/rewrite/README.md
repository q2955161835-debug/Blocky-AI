# 小学 Agent 创作教育材料制作入口

小学读懂、改造、自主搭建、调试解释是两稿主线；用户明确不写团队介绍。个人版完全开源与社区、机构组织后台、独立算力、多端和Agent App均作为建设方向，当前Windows为阶段成果。

## 当前输入

- build-investor-ppt.cjs：37页连续讲述PPT；新增按人头算力、24个月资金用途、厂商结算、回款与资源情景五页。原生可编辑表格与文字，真实截图和概念插画沿用已有素材。
- speaker-notes-v3.json：37页讲稿、公开来源及相邻转场，文件名沿用制作入口；每页时间仅作讲述参考。
- business-plan-v2.json：内容4.0版，21页独立BP；六张资金表读取新funding-summary.json，正文中的关键数字同步维护。
- build-business-plan.py：只读技能Word模板生成黑白A4文档，当前原生Word输出显式使用宋体。
- refresh-toc.py：从实际PDF标题位置更新TOC缓存，保留可更新字段。
- check-word-cjk.py：保留Word标准检查；用--font宋体核对本次明确采用的统一字体。
- sanitize-package.py：清理无关插件、路径与个人元数据，保留原生截图裁切、表格和财务数据；修复已有生成器的包引用与对象ID问题。
- export-ppt.ps1：独立PowerPoint实例只读打开候选、原生导出PDF并关闭本次实例。
- export-business-plan.ps1：当前使用-Engine Word导出21页BP；仅关闭本次实例。保留可用时选择LibreOffice的入口，本轮不依赖此前已不存在的本地运行时。
- investor-revision-research.md：2026-10-03官方Scratch、BBAI、Tynker、教育部和算力产品研究，明确各页面支持的范围。
- check-example.ts、story-*.json：本地Runtime条件对照，不代表完整故事生成或真实课堂。

## 生成与检查

先按[新资金模型](../funding-24m/README.md)生成、原生重算和审计工作簿，再提取共享摘要。所有新输出先进入项目try。

```powershell
node doc/制作资料/2026-10-03-答辩与商业计划书/rewrite/build-investor-ppt.cjs
python doc/制作资料/2026-10-03-答辩与商业计划书/rewrite/sanitize-package.py try/funding-24m-20261003/presentation/Blocky-Studio-小学Agent创作教育-2026-10-03.pptx
& doc/制作资料/2026-10-03-答辩与商业计划书/rewrite/export-ppt.ps1 -Path try/funding-24m-20261003/presentation/Blocky-Studio-小学Agent创作教育-2026-10-03.pptx
```

使用已配置Node/Python运行时及PptxGenJS；模块通过NODE_PATH解析。Word生成器使用--template指定只读技能模板、--content指定本目录business-plan-v2.json、--finance指定../funding-24m/funding-summary.json、--font宋体、--output指定try下DOCX。已有候选需显式--overwrite。

DOCX导出PDF后，使用refresh-toc.py传入DOCX和对应PDF，再次原生导出并核对全部页、目录起页和嵌入字体。本次PDF仅嵌入SimSun，采用宋体是明确的中文排版选择，不能只看DOCX字体标签就推断PDF字体。最终五文件都要绑定新哈希；清理XLSX不得改变工作表、样式、共享文本与计算链。

## 历史与边界

旧试点三年预算不用于本次完整建设资金，旧17页PPT与2.1版讲稿、35页/3.0版BP的内容可通过Git恢复。原[投资顾问复验](../../../验收/任务/验收-2026-10-03-投资顾问整改最终复验.md)只绑定原五文件，本轮资金结论以[24个月独立验收](../../../验收/任务/验收-2026-10-03-24个月资金与算力预算.md)为准。

本次材料任务不实施产品源码、实际开源发布、机构后台或计费系统，不新增ImageGen或Blocky外部模型请求。历史模型响应只属于原合成资料产品演示，教学效果、真实用户、合同和融资不由预算推导。后续产品开发以[完整开发计划](../../../执行计划/2026-08-23-Blocky-竞品驱动完整开发计划.md)为入口。
