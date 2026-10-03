"""Extract narrative figures only from recalculated native Excel caches."""
import argparse, json, hashlib
from pathlib import Path
import openpyxl

parser=argparse.ArgumentParser();parser.add_argument('--workbook',type=Path,required=True);parser.add_argument('--output',type=Path,required=True);parser.add_argument('--perturbations',type=Path,required=True);args=parser.parse_args()
w=openpyxl.load_workbook(args.workbook,data_only=True);errors=[f'{s.title}!{c.coordinate}:{c.value}' for s in w for row in s for c in row if c.data_type=='e']
if errors:raise ValueError(errors)
summary=w['Summary'];scenarios=[]
mapping={5:'cloud_people_end',6:'customer_token_cost',7:'dev_compute',8:'payroll',9:'other_ops',10:'equipment',11:'cash_paid',12:'cash_collected',13:'owner_cash',14:'peak_cash_deficit',15:'contingency',16:'vendor_buffer_remaining',17:'cash_reserve',18:'required_additional_funding',19:'proposed_funding',20:'ending_cash_with_funding',21:'token_monthly_end',22:'peak_month'}
for c in [2,3,4]:
 row={'name':summary.cell(4,c).value};row.update({key:summary.cell(r,c).value for r,key in mapping.items()});row['rounding_headroom']=row['proposed_funding']-row['required_additional_funding'];scenarios.append(row)
whatifs=[]
for variant in json.loads(args.perturbations.read_text(encoding='utf-8')):
 v=openpyxl.load_workbook(variant['path'],data_only=True);actual={key:v['Summary'].cell(r,3).value for r,key in [(18,'required_additional_funding'),(19,'proposed_funding'),(20,'ending_cash_with_proposed_funding')]}
 for key,value in actual.items():
  if abs(value-variant['expected'][key])>.01:raise ValueError(f'Perturbation mismatch {variant["name"]}: {key}')
 if any(v['Checks'].cell(8,c).value!='PASS' for c in [2,3,4]):raise ValueError('Perturbation checks failed')
 whatifs.append({'name':variant['name'],'changes':variant['changes'],**actual,'check':'PASS'})
base=scenarios[1];cost=w['Costs'];detail={name:cost.cell(row,26).value for name,row in [('infrastructure',31),('teaching',32),('community',33),('admin',34),('specialist',35)]}
people=[];co=w['Cohorts'];prices=w['Assumptions']
for label,r,pr in [('学生',17,29),('教师',18,30),('个人',19,31)]:
 tokenrow=r+4;people.append({'type':label,'person_months':sum(co.cell(r,c).value for c in range(2,26)),'end_people':co.cell(r,25).value,'cost_per_month':prices.cell(pr,2).value,'cost_24m':sum(co.cell(tokenrow,c).value for c in range(2,26))})
money=lambda x:f'{x/10000:,.3f}'
uses=[['研发、教研与运营等效人力',base['payroll'],'前6月3人、后18月4人；综合人月2万元，非现有成员履历'],['内部研发工具与算力',base['dev_compute'],'按等效开发人头每月1200元；与外部用户算力分开'],['专项外部交付',detail['specialist'],'平台/应用壳与测试交付按阶段采购；不重复人力预算'],['云基础设施',detail['infrastructure'],'账户、后台、存储、监测等；不包含用户Token消耗'],['外部用户Token采购',base['customer_token_cost'],'学生/教师/个人的实际云算力活跃人头×各类人均月成本'],['教学共创与试用',detail['teaching'],'活动、设备配置与材料支出；人员报酬已在人力项'],['社区活动与内容材料',detail['community'],'共创活动与材料；不重复运营人员薪酬'],['一般运营与合规预算',detail['admin'],'行政与合规支持预算；具体报价需按范围更新'],['测试设备购置',base['equipment'],'现金购置；36个月折旧单列，不能再加到现金支出'],['常规支出风险预留',base['contingency'],'常规固定与专项支出10%；不是提前确认的费用'],['厂商合作现金预留',base['vendor_buffer_remaining'],'合作报价未知；费用、预付额度和保证金分别记录，占用预留'],['正常运营现金储备',base['cash_reserve'],'期末正常月支出及未收回的算力成本×3个月'],['资金取整余量',base['rounding_headroom'],'最低需求按50万元步长取整，保持资金来源用途一致']]
if abs(sum(row[1] for row in uses)-base['proposed_funding'])>.01:raise ValueError('Uses do not equal proposed funding')
tables={
 'uses':{'headers':['资金用途','24个月预算（万元）','用途与计算边界'],'rows':[[r[0],money(r[1]),r[2]] for r in uses],'widths':[1.7,1.0,3.0]},
 'people':{'headers':['云算力用户','期末活跃人头','累计人月','人均月成本（元）','24个月成本（万元）'],'rows':[[r['type'],str(r['end_people']),str(r['person_months']),str(r['cost_per_month']),money(r['cost_24m'])] for r in people],'widths':[.8,.9,.9,1.0,1.4]},
 'scenarios':{'headers':['资源情景','24个月现金支出（万元）','最低追加需求（万元）','资金规划目标（万元）'],'rows':[[s['name'],money(s['cash_paid']),money(s['required_additional_funding']),money(s['proposed_funding'])] for s in scenarios],'widths':[1.3,1.3,1.3,1.3]},
 'funding':{'headers':['现金层级','基准金额（万元）','含义'],'rows':[['24个月建设与用量支出',money(base['cash_paid']),'不以未确定收入抵减的覆盖预算'],['常规风险预留',money(base['contingency']),'常规固定及专项支出10%'],['厂商合作现金预留',money(base['vendor_buffer_remaining']),'待条款明确后转入费、额度资产或保证金'],['正常运营现金储备',money(base['cash_reserve']),'期末正常净月支出×3'],['最低追加资金',money(base['required_additional_funding']),'未确认自有资金默认不抵减'],['取整资金规划目标',money(base['proposed_funding']),'按50万元步长取整；余量'+money(base['rounding_headroom'])+'万元']],'widths':[1.8,1.0,2.9]},
 'sensitivity':{'headers':['单独调整条件','最低追加需求（万元）','取整目标（万元）','解释'],'rows':[['基准覆盖预算',money(base['required_additional_funding']),money(base['proposed_funding']),'未确认回款不抵减；合作条件未录入']]+[[{'recover80':'算力成本回收80%、当月收款','fee100w':'非退还合作费100万元','prepay-and-deposit':'额度预付100万+保证金10万+合作费30万','own20w':'确认自有资金20万元','late-recovery':'成本回收80%、延迟2个月'}[s['name']],money(s['required_additional_funding']),money(s['proposed_funding']),{'recover80':'成本回收不是正式售价；收款须实际落实','fee100w':'压力参数不是报价；已发生合作费占用原预留','prepay-and-deposit':'额度按消耗抵扣、余量与保证金为资产；不双算','own20w':'只有已确认投入才能抵减外部需求','late-recovery':'相同回收比例，收款延迟增加营运资金'}[s['name']]] for s in whatifs],'widths':[1.8,.9,.9,2.1]},
 'assumptions':{'headers':['ID','参数','基准口径','依据与置信度'],'rows':[['F01','期间','2026-11至2028-10，共24个月','24个月用户确认；起点为规划假设'],['F02','云用户','期末学生2400、教师240、个人2500；累计人月按季度曲线','低置信规模情景，非已获得用户'],['F05','等效资源','前6月3人、后18月4人；综合人月2万元','低置信能力与成本预算，非现有团队介绍'],['F06','按人头算力','学生10、教师50、个人30元/月；研发1200元/人月','采购成本规划，非用户订阅价或厂商报价'],['F07','合作条件','非退还费/预付/保证金未报价；现金预留30万元','0仅表示未录入；获得条款后重新测算'],['F08','现金储备','3个月正常运营；常规支出风险预留10%；目标按50万取整','规划政策；预留不确认费用'],['F09','回款与自有资金','默认回收率0、自有现金0；另算80%回收情景','未知收款不用于降低需求，不表示业务实际为零'],['F10','资产与费用','设备36个月折旧；额度和保证金为资产，按消耗/条件结转','示例会计政策，签约及实际处理再核对']],'widths':[.6,1.0,2.0,2.0]}}
out={'currency':'CNY','period':'2026-11–2028-10','months':24,'status':'全部金额与人数为资源规划；非真实报价、客户或融资承诺','provenance':{'workbook':str(args.workbook.resolve()),'sha256':hashlib.sha256(args.workbook.read_bytes()).hexdigest(),'method':'native Excel recalculated cache extraction','formula_count':5583},'scenarios':scenarios,'base':base,'base_cost_detail':detail,'people':people,'whatifs':whatifs,'bp_tables':tables,'sources':[{'title':'DeepSeek Models & Pricing','url':'https://api-docs.deepseek.com/quick_start/pricing/','accessed':'2026-10-03','scope':'Token分类、余额抵扣机制；不证明本项目人均成本或合作费'},{'title':'Cursor Pricing','url':'https://cursor.com/pricing','accessed':'2026-10-03','scope':'按用户订阅、内含用量、额外按量及组织洽谈；不证明本项目价格'}]}
args.output.write_text(json.dumps(out,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'summary':str(args.output),'base':base,'people':people,'perturbations_passed':len(whatifs)},ensure_ascii=False,indent=2))
