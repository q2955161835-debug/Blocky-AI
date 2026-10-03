# 24个月资金与按人头算力模型

当前模型覆盖2026-11至2028-10，人民币，固定24个月。新版PPT与BP共用这里的原生Excel缓存摘要；没有使用旧试点合同预算外推完整产品资金。

## 输入与核算

- `inputs.json`：学生、教师、个人平台云活跃人数曲线、人均采购成本、等效资源与运营预算。人数和金额均为规划假设；BYOK与本地用户不进入平台采购人数。
- `build_funding.py`：生成普通新工作簿，共11表、5583公式；先写设计审计规范再生成工作簿。未修改受保护技能模板。
- `audit-spec.json`：作者设计门禁，检查公式、输入、策略、缓存与现金勾稽；独立验收另外重算，不能把作者预期称为独立证据。
- `recalculate-excel.ps1`：独立后台Excel实例完整重算、保存并可导出PDF；只关闭本次实例。
- `prepare_perturbations.py`：生成5份条件测算副本，需逐份原生重算；不修改基准文件。
- `extract_summary.py`：从原生重算缓存提取金额、六张BP表和来源，拒绝错误缓存及不一致条件测算。
- `funding-summary.json`：当前基准最低追加463.025万元、取整目标500万元；冻结文件哈希和取数方法保存在provenance。

厂商非退还合作费、预付额度、保证金和实际自有资金的0表示未录入。默认不以未确认回款抵减资金；成本回收比例不是套餐售价、转化率或毛利率。预付额度按消耗抵扣，剩余额度和保证金是资产。设备现金与折旧分别核算。资金需求为峰值缺口、风险预留、未使用合作现金预留与正常运营储备之和。

蓝色单元格为预算输入。本次期间固定24个月；改变规划长度需要修改生成器和人数曲线，不能只改月份数量。工资为综合人月资源预算；等效人力不代表现有团队履历。算力人均成本仅用于汇总预算，后台实际计量仍按模型和调用账单核算。

## 复建顺序

在项目根目录使用已配置Python、Node、openpyxl、lxml、PptxGenJS和本机Office。这里未安装全局依赖。云端没有Office时，需要用可完整重算公式的环境生成新候选并重新审计，不能把空缓存当成结果。

```powershell
python doc/制作资料/2026-10-03-答辩与商业计划书/funding-24m/build_funding.py --inputs doc/制作资料/2026-10-03-答辩与商业计划书/funding-24m/inputs.json --output try/funding-24m-20261003/Blocky-Studio-财务测算-2026-10-03.xlsx --spec doc/制作资料/2026-10-03-答辩与商业计划书/funding-24m/audit-spec.json
& doc/制作资料/2026-10-03-答辩与商业计划书/funding-24m/recalculate-excel.ps1 -Path try/funding-24m-20261003/Blocky-Studio-财务测算-2026-10-03.xlsx -Pdf try/funding-24m-20261003/workbook-all-pages.pdf
python doc/制作资料/2026-10-03-答辩与商业计划书/funding-24m/prepare_perturbations.py --workbook try/funding-24m-20261003/Blocky-Studio-财务测算-2026-10-03.xlsx --inputs doc/制作资料/2026-10-03-答辩与商业计划书/funding-24m/inputs.json --output-dir try/funding-24m-20261003
```

再依次对recover80、fee100w、prepay-and-deposit、own20w、late-recovery的XLSX执行同一原生重算脚本。原生Office可能注入本机插件和个人元数据，保存后用既有`rewrite/sanitize-package.py`清理基准XLSX，再审计并提取摘要：

```powershell
python doc/制作资料/2026-10-03-答辩与商业计划书/rewrite/sanitize-package.py try/funding-24m-20261003/Blocky-Studio-财务测算-2026-10-03.xlsx
python .agents/skills/build-client-business-plans/scripts/audit_financial_model.py try/funding-24m-20261003/Blocky-Studio-财务测算-2026-10-03.xlsx --spec doc/制作资料/2026-10-03-答辩与商业计划书/funding-24m/audit-spec.json
python doc/制作资料/2026-10-03-答辩与商业计划书/funding-24m/extract_summary.py --workbook try/funding-24m-20261003/Blocky-Studio-财务测算-2026-10-03.xlsx --output doc/制作资料/2026-10-03-答辩与商业计划书/funding-24m/funding-summary.json --perturbations try/funding-24m-20261003/perturbations.json
```

财务清理必须保持工作表、样式、共享文本与计算链内容；清理后重新读缓存和勾稽。数值变更后同步PPT和BP正文、表格、讲稿与正式独立验收，不能只替换摘要。成品复制与哈希清单留在交付及验收目录，过程文件整理到项目try/待清理。
