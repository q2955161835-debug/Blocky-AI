# 小学创作教育稿制作入口

本目录是可复用制作输入，不随参赛成品提交。产品源码未修改。PPT文字、5张表和财务图原生可编辑；真实截图只用原生裁切，概念图由ImageGen生成。

- `build-ppt.cjs`：17页新教育稿，读取项目内图片与原财务汇总，使用已安装的PptxGenJS 4.0.1。
- `business-plan-v2.json`：当前2.1版独立商业计划书内容，与原三情景假设一致。
- `build-business-plan.py`：只读技能Word模板，生成黑白A4文档；唯一字体Noto Sans CJK SC。
- `refresh-toc.py`：从Heading 1–3及实际PDF测得页码更新真实TOC缓存/PAGEREF；保留可更新字段。
- `sanitize-package.py`：清理未引用模板数据和图片描述路径；原生裁切真实轨迹；XLSX只清理路径及任务窗格元数据，不改表格、公式、缓存或打印设置。
- `check-word-cjk.py`：上游Word检查器仅将硬编码Arial预期改为统一中文字体；其余11类规则保持。上游检查器也已执行，其唯一不匹配为Arial预期，技能正文只规定一种字体。
- `check-example.ts`及两份`story-*.json`：本地领域Runtime条件部件复现实验，不是生成式故事、Windows普通包或学生试用。
- `speaker-notes-v2.json`：与新PPT完全一致的12页480秒讲稿及5页备答。

在仓库根目录使用已有Node/Python及soffice：

```sh
node doc/制作资料/2026-10-03-答辩与商业计划书/rewrite/build-ppt.cjs
python doc/制作资料/2026-10-03-答辩与商业计划书/rewrite/build-business-plan.py --template .agents/skills/build-client-business-plans/assets/business-plan-template.docx --content doc/制作资料/2026-10-03-答辩与商业计划书/rewrite/business-plan-v2.json --finance doc/制作资料/2026-10-03-答辩与商业计划书/finance-summary.json --output try/education-rewrite/Blocky-Studio-小学Agent商业计划书-2026-10-03.docx
```

生成后先执行包清理、soffice导出PDF，再以`refresh-toc.py DOCX PDF`更新目录并重新导出。已存在文件须显式`--overwrite`；重新生成即成为新候选，不能外推旧验收。脚本使用当前已配置运行时，未把依赖或Office profile纳入Git。

旧v6与旧BP文案留作历史输入，不直接运行生成新稿。公开竞品核对沿用交接记录；云端对3个官方页面访问均被代理403拒绝，未绕过网络策略，也没有虚构新核验。删去全国全学段规模推断。

本轮调用ImageGen一次；没有新增Blocky真实外部大模型请求。历史息壤3响应7717Token只属于合成课程演示。

用户后续要求补充“从代码审阅到积木审阅”和OPC的Agent员工透明化。PPT第10页改为搭建、执行、运行三阶段审阅与OPC后续方向，第2页及讲稿同步价值表述；总17页和480秒预算不变。商业计划书2.1版在摘要、产品价值、竞争定位与市场进入顺序补充对应内容，导出18页，真实TOC22项已刷新。OPC仍待验证，不计入财务预测；本次不新增ImageGen或产品模型请求。旧交付四份文件已可逆归档，复验记录见两份独立报告顶部。

## 本地批注文案修订

2026-10-03用户要求删除PPT中的负面提示与“待验证”。本轮直接原位替换OOXML可见文字，并同步`build-ppt.cjs`：以“教学设计”“课堂实践计划”和“经营规划”等表述说明方向，保留实际能力、教学方案与预算之间的事实区别。原生对象、图片裁切、图表数据、备注与财务数字未改；PDF由本机PowerPoint导出。信息量与商业论证问题由投资顾问独立复核，文案修订不代表已完成扩充。历史通过仅适用于原哈希文件。
