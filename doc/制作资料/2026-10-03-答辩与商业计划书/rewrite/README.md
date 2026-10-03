# 小学 Agent 创作教育材料制作入口

本目录保存可复用制作输入，不随参赛成品提交。当前投资顾问整改稿以小学读懂、改造、自主搭建、调试解释为主线，保留积木审阅价值。用户明确不写团队成员介绍；交付资产和服务资源承担项目交付说明。

## 当前输入

- build-investor-ppt.cjs：35页连续讲述PPT，全部内容融入产品、学习、教师、商业和完整开发路线章节，合作邀请为最后一页；原生可编辑文字、表格和财务图。真实截图与概念插画沿用已有素材。
- speaker-notes-v3.json：35页讲稿、来源和转场；855秒是讲稿参考预算，不是用户限定时长或实测演讲时间。
- business-plan-v2.json：文件名沿用既有入口，内容版本为3.0；独立商业计划书，不改变原三情景财务输入。
- build-business-plan.py：只读技能Word模板生成黑白A4文档；中文统一使用本机已安装的Noto Sans SC。
- refresh-toc.py：从实际PDF标题位置刷新TOC页码缓存，保留可更新字段。
- check-word-cjk.py：保留Word标准检查，中文字体预期适配为统一字体；目录字段生成的样式按其实际用途检查。
- sanitize-package.py：清理模板与路径元数据，按图片标记原生裁切轨迹；修复PptxGenJS 4.0.1产生的不存在部件引用和重复对象ID。原生表格使用合法的middle对齐参数。
- export-ppt.ps1：在独立PowerPoint实例中只读打开候选并导出PDF，再关闭本次实例。
- export-business-plan.ps1：使用项目内LibreOffice独立运行时和profile导出22页BP；静态Noto Sans SC字体从本机字体目录复制到该运行时，验证PDF实际嵌入字体。
- investor-revision-research.md：2026-10-03核对的Scratch、Blocks Builder AI与教育部官方资料；明确公开资料的阅读范围。
- check-example.ts、两份story-*.json：真实本地Runtime条件对照，不能代表完整故事生成、普通包课堂或学生试用。

## 生成与检查

使用已有Node/Python运行时及PptxGenJS 4.0.1；模块目录通过运行时提供的NODE_PATH解析。输出先进入项目try，原始财务摘要与XLSX只读。当前PPT命令入口为：

```powershell
node doc/制作资料/2026-10-03-答辩与商业计划书/rewrite/build-investor-ppt.cjs
python doc/制作资料/2026-10-03-答辩与商业计划书/rewrite/sanitize-package.py try/investor-iteration-20261003/presentation/Blocky-Studio-小学Agent创作教育-2026-10-03.pptx
& doc/制作资料/2026-10-03-答辩与商业计划书/rewrite/export-ppt.ps1 -Path try/investor-iteration-20261003/presentation/Blocky-Studio-小学Agent创作教育-2026-10-03.pptx
```

Word生成器使用--template指定只读模板、--content指定business-plan-v2.json、--finance指定原finance-summary.json、--output指定try下候选路径。DOCX生成后须导出PDF、按实际页码刷新TOC并再次导出，核对全部页和嵌入字体。export-business-plan.ps1的Document、LibreOfficeRuntime、Profile参数须分别提供项目候选、项目本地运行时和独立profile绝对路径；本轮运行时已整理到try/待清理/2026-10-03-投资顾问材料整改/business/libreoffice-runtime/，重生成前检查目录存在。Windows Word可能替换字体，DOCX字体标签正确不能代替PDF字体核验。已存在文件须显式使用生成器的--overwrite。任何重生成都是新候选，必须重新绑定哈希与实际变化。

## 历史与证据边界

旧17页PPT制作源与2.1版讲稿已由当前入口替代，移出当前制作目录；历史内容可通过Git恢复。旧验收只提供原文件证据。当前成品与结论见[投资顾问整改最终复验](../../../验收/任务/验收-2026-10-03-投资顾问整改最终复验.md)。

本轮完成计划见[归档执行计划](../../../归档/2026-10-03/2026-10-03-投资顾问材料整改与复验.md)；后续产品开发仍以[完整开发计划](../../../执行计划/2026-08-23-Blocky-竞品驱动完整开发计划.md)为入口，不能把本次材料任务完成当成产品路线全部完成。

本轮不改产品源码和财务工作簿，不新增ImageGen或Blocky真实大模型API请求。历史息壤3响应、7717Token只属于合成课程资料演示；完整故事链、小学课堂、机构合同与经营数字分别按教学设计或规划呈现。
