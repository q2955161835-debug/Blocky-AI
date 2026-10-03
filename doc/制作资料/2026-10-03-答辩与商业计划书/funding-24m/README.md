# 24个月资金与按人头算力模型

当前模型覆盖2026-11至2028-10，人民币，固定24个月。新版PPT与BP共用这里的原生Excel缓存摘要；没有使用旧试点合同预算外推完整产品资金。

## 输入与核算

- `inputs.json`：真实短任务Token样本、当前官方单价、专业Agent公开月度成本、参考汇率；任务频次、等效资源、运营及条件用户容量为规划假设。BYOK与本地用户排除。
- `build_funding.py`：沿用原生财务架构，新增Usage依据与推导，共12表、5596公式。保护模板保持只读。
- `audit-spec.json`：作者设计门禁，检查公式、输入、策略、缓存与现金勾稽；独立验收另外重算，不能把作者预期称为独立证据。
- `recalculate-excel.ps1`：独立后台Excel实例完整重算、保存并可导出PDF；只关闭本次实例。
- `prepare_perturbations.py`：生成5份条件测算副本，需逐份原生重算；不修改基准文件。
- `extract_summary.py`：从原生重算缓存提取金额、六张BP表和来源，拒绝错误缓存及不一致条件测算。
- `funding-summary.json`：基准最低追加866.443万元、完整覆盖目标900万元；前18月研发现金196.413万元，后续容量按准备关口启用。哈希及取数方法保存在provenance。
- `token-cost-evidence.md`：内部来源笔记，区分实际Token、直供重定价、开发者统计和假设，不放入公开成品。

短任务样本10个有回执任务、30响应，输入76845、输出5738；缓存及部分失败用量未知。学生40次/月、教师240次/月只作短任务情景，不能当完整专业模板或课堂账单。专业云创作者单列Claude Code企业150–250美元/月统计，以200美元中点和2026-09-30参考汇率6.7351换算；研发另用13美元/活跃日×22天，二者不叠加。直供DeepSeek价格不能替代息壤实际采购和合作条款。

规划前18月为研发，场景预算第19月后且产品准备完成才启用。月份和人数均为条件资源排期；关口延期则调整启用月及人数曲线。900万元是完整24个月、未来专业容量且不抵减未知回款的覆盖情景，不等同现阶段融资报价。

厂商非退还合作费、预付额度、保证金和实际自有资金的0表示未录入。默认不以未确认回款抵减资金；成本回收比例不是套餐售价、转化率或毛利率。预付额度按消耗抵扣，剩余额度和保证金是资产。设备现金与折旧分别核算。资金需求为峰值缺口、风险预留、未使用合作现金预留与正常运营储备之和。

蓝色单元格为预算输入。本次期间固定24个月；改变规划长度需要修改生成器和人数曲线，不能只改月份数量。工资为综合人月资源预算；等效人力不代表现有团队履历。算力人均成本仅用于汇总预算，后台实际计量仍按模型和调用账单核算。

## 复建顺序

在项目根目录使用已配置Python、Node、openpyxl、lxml、PptxGenJS和本机Office。这里未安装全局依赖。云端没有Office时，需要用可完整重算公式的环境生成新候选并重新审计，不能把空缓存当成结果。

```powershell
python doc/制作资料/2026-10-03-答辩与商业计划书/funding-24m/build_funding.py --inputs doc/制作资料/2026-10-03-答辩与商业计划书/funding-24m/inputs.json --output try/rd-narrative-20261003/Blocky-Studio-财务测算-2026-10-03.xlsx --spec doc/制作资料/2026-10-03-答辩与商业计划书/funding-24m/audit-spec.json
& doc/制作资料/2026-10-03-答辩与商业计划书/funding-24m/recalculate-excel.ps1 -Path try/rd-narrative-20261003/Blocky-Studio-财务测算-2026-10-03.xlsx -Pdf try/rd-narrative-20261003/workbook-all-pages.pdf
python doc/制作资料/2026-10-03-答辩与商业计划书/funding-24m/prepare_perturbations.py --workbook try/rd-narrative-20261003/Blocky-Studio-财务测算-2026-10-03.xlsx --inputs doc/制作资料/2026-10-03-答辩与商业计划书/funding-24m/inputs.json --output-dir try/rd-narrative-20261003
```

再依次对recover80、fee100w、prepay-and-deposit、own20w、late-recovery的XLSX执行同一原生重算脚本。原生Office可能注入本机插件和个人元数据，保存后用既有`rewrite/sanitize-package.py`清理基准XLSX，再审计并提取摘要：

```powershell
python doc/制作资料/2026-10-03-答辩与商业计划书/rewrite/sanitize-package.py try/rd-narrative-20261003/Blocky-Studio-财务测算-2026-10-03.xlsx
python .agents/skills/build-client-business-plans/scripts/audit_financial_model.py try/rd-narrative-20261003/Blocky-Studio-财务测算-2026-10-03.xlsx --spec doc/制作资料/2026-10-03-答辩与商业计划书/funding-24m/audit-spec.json
python doc/制作资料/2026-10-03-答辩与商业计划书/funding-24m/extract_summary.py --workbook try/rd-narrative-20261003/Blocky-Studio-财务测算-2026-10-03.xlsx --output doc/制作资料/2026-10-03-答辩与商业计划书/funding-24m/funding-summary.json --perturbations try/rd-narrative-20261003/perturbations.json
```

财务清理必须保持工作表、样式、共享文本与计算链内容；清理后重新读缓存和勾稽。数值变更后同步PPT和BP正文、表格、讲稿与正式独立验收，不能只替换摘要。成品复制与哈希清单留在交付及验收目录，过程文件整理到项目try/待清理。
