"""Independent acceptance arithmetic. Does not import the production generator."""
from pathlib import Path
from decimal import Decimal, ROUND_HALF_UP
import json,math,hashlib,openpyxl

root=Path('try/funding-24m-20261003')
inputs=json.loads(Path('doc/制作资料/2026-10-03-答辩与商业计划书/funding-24m/inputs.json').read_text(encoding='utf-8'))
files=['Blocky-Studio-财务测算-2026-10-03.xlsx','recover80.xlsx','fee100w.xlsx','prepay-and-deposit.xlsx','own20w.xlsx','late-recovery.xlsx']
reports=[]
for fname in files:
 w=openpyxl.load_workbook(root/fname,data_only=True); f=openpyxl.load_workbook(root/fname,data_only=False)
 a=w['Assumptions']; owner,rate,lag,fee,prepay,deposit,paymonth,life,step=[a.cell(r,2).value for r in range(4,13)]
 mismatches=[]; comparisons=0; scenarios=[]
 def check(sheet,row,column,value):
  global comparisons
  comparisons+=1; actual=w[sheet].cell(row,column).value
  if not isinstance(actual,(float,int)) or abs(actual-value)>.01:mismatches.append({'cell':f'{sheet}!{openpyxl.utils.get_column_letter(column)}{row}','actual':actual,'expected':value})
 for i,s in enumerate(inputs['scenarios']):
  co,ct,rv,cf,ip,bs=[1+i*k for k in [14,25,12,33,18,18]]
  monthly=[]; balance=owner; wallet=0; guarantee=0; total_income=0; total_receipt=0; total_profit=0; equipment_gross=0; depreciation_acc=0
  for m in range(1,25):
   scale=a.cell(20,i+2).value; costscale=a.cell(21,i+2).value; other=a.cell(22,i+2).value
   people=[int(Decimal(str(a.cell(46+m,c).value*scale)).quantize(Decimal('1'),rounding=ROUND_HALF_UP)) for c in [2,3,4]]
   token_parts=[people[k]*a.cell(29+k,2).value*costscale for k in range(3)]; token=sum(token_parts)
   fte=a.cell(17 if m<=6 else 18,i+2).value; wage=fte*a.cell(19,i+2).value; dev=fte*a.cell(32,2).value*other
   infra=a.cell(34 if m<=6 else 35 if m<=12 else 36,2).value*other
   teaching=a.cell(37 if m<=3 else 38 if m<=12 else 39,2).value*other
   community=a.cell(40 if m<=3 else 41 if m<=12 else 42,2).value*other
   admin=a.cell(43,2).value*other
   specialist=sum(a.cell(r,7).value for r in range(47,51) if a.cell(r,6).value==m)*other
   equipment=sum(a.cell(r,7).value for r in [54,55] if a.cell(r,6).value==m)*other
   deprec=sum(a.cell(r,7).value/life for r in [54,55] if 0<=m-a.cell(r,6).value<life)*other
   normal=wage+dev+infra+teaching+community+admin; operating=normal+specialist
   topup=prepay if m==paymonth else 0; refundable=deposit if m==paymonth else 0; nonrefund=fee if m==paymonth else 0
   starting_wallet=wallet; offset=min(wallet+topup,token); wallet+=topup-offset; guarantee+=refundable
   procurement_cash=token-offset+topup; paid=operating+procurement_cash+nonrefund+refundable+equipment
   income=token*rate; receipt=income if lag==0 else monthly[m-1-lag]['income'] if m>lag else 0
   opening=balance; balance+=receipt-paid; total_income+=income; total_receipt+=receipt
   receivable=total_income-total_receipt; profit=income-token-operating-nonrefund-deprec; total_profit+=profit
   equipment_gross+=equipment;depreciation_acc+=deprec; net_equipment=equipment_gross-depreciation_acc
   record=dict(people=people,token=token,token_parts=token_parts,fte=fte,wage=wage,dev=dev,infra=infra,teaching=teaching,community=community,admin=admin,specialist=specialist,equipment=equipment,deprec=deprec,normal=normal,operating=operating,income=income,receipt=receipt,receivable=receivable,opening=opening,balance=balance,wallet=wallet,guarantee=guarantee,procurement_cash=procurement_cash,paid=paid,profit=profit,total_profit=total_profit,net_equipment=net_equipment,nonrefund=nonrefund)
   monthly.append(record)
   col=m+1
   for off,val in {2:people[0],3:people[1],4:people[2],5:sum(people),6:token_parts[0],7:token_parts[1],8:token_parts[2],9:token}.items():check('Cohorts',co+off,col,val)
   costs=[fte,wage,dev,infra,teaching,community,admin,specialist,token,nonrefund,operating+token+nonrefund,equipment,deprec,operating+token+nonrefund+deprec,operating,normal]
   for off,val in enumerate(costs,2):check('Costs',ct+off,col,val)
   for off,val in {2:token,3:income,4:receipt,5:receivable}.items():check('Revenue',rv+off,col,val)
   cf_values={2:opening,3:receipt,4:operating,5:token,6:topup,7:starting_wallet,8:offset,9:wallet,10:procurement_cash,11:nonrefund,12:refundable,13:equipment,14:paid,15:receipt-paid,16:balance,20:guarantee,21:wallet,22:receivable,23:net_equipment,24:0}
   for off,val in cf_values.items():check('Cash Flow',cf+off,col,val)
   for off,val in {2:income,3:token,4:income-token,5:operating,6:nonrefund,7:deprec,8:profit}.items():check('Income Statement',ip+off,col,val)
  total=lambda k:sum(x[k] for x in monthly)
  peak=max(0,-min(x['balance'] for x in monthly));risk=total('operating')*a.cell(24,i+2).value
  vendor_unused=max(0,a.cell(23,i+2).value-total('nonrefund')-guarantee-wallet)
  reserve=a.cell(25,i+2).value*(monthly[-1]['normal']+monthly[-1]['token']*(1-rate))
  need=peak+risk+vendor_unused+reserve;proposal=math.ceil(need/step)*step
  for m,x in enumerate(monthly,2):
   cash=x['balance']+proposal;capital=owner+proposal
   asset=cash+x['receivable']+x['wallet']+x['guarantee']+x['net_equipment']
   for off,val in {2:cash,3:x['receivable'],4:x['wallet'],5:x['guarantee'],6:x['net_equipment'],7:asset,8:capital,9:x['total_profit'],10:asset-capital-x['total_profit']}.items():check('Balance Sheet',bs+off,m,val)
   check('Cash Flow',cf+19,m,cash)
  summary={5:sum(monthly[-1]['people']),6:total('token'),7:total('dev'),8:total('wage'),9:total('operating')-total('dev')-total('wage'),10:total('equipment'),11:total('paid'),12:total('receipt'),13:owner,14:peak,15:risk,16:vendor_unused,17:reserve,18:need,19:proposal,20:balance+proposal,21:monthly[-1]['token']}
  for row,value in summary.items():check('Summary',row,i+2,value)
  scenarios.append(dict(name=s['name'],person_months=[sum(x['people'][k] for x in monthly) for k in range(3)],token=total('token'),cash_paid=total('paid'),expense=total('operating')+total('token')+total('nonrefund')+total('deprec'),depreciation=total('deprec'),equipment_net=monthly[-1]['net_equipment'],receivable=monthly[-1]['receivable'],prepay_balance=wallet,deposit_asset=guarantee,fee_expense=total('nonrefund'),peak=peak,risk=risk,vendor_unused=vendor_unused,reserve=reserve,minimum=need,proposal=proposal,profit=total('profit')))
 formulas=sum(isinstance(c.value,str) and c.value.startswith('=') for sh in f for row in sh for c in row)
 reports.append(dict(file=fname,sha256=hashlib.sha256((root/fname).read_bytes()).hexdigest(),formulas=formulas,comparisons=comparisons,mismatches=mismatches,scenarios=scenarios))
(root/'independent-model-review.json').write_text(json.dumps(reports,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps([{'file':r['file'],'comparisons':r['comparisons'],'mismatches':len(r['mismatches']),'base':r['scenarios'][1]} for r in reports],ensure_ascii=False,indent=2))
