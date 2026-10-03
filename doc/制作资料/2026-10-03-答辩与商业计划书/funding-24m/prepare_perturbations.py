"""Prepare ordinary fallback copies; native Excel must recalculate each copy."""
import argparse, json
from pathlib import Path
import openpyxl
from build_funding import projected

parser=argparse.ArgumentParser()
parser.add_argument('--workbook',type=Path,required=True)
parser.add_argument('--inputs',type=Path,required=True)
parser.add_argument('--output-dir',type=Path,required=True)
args=parser.parse_args()
out=args.output_dir.resolve()
if not any(p.name=='try' for p in (out,*out.parents)):
    raise ValueError('Perturbation candidates must stay in project try')
data=json.loads(args.inputs.read_text(encoding='utf-8'))
variants=[('recover80',{'recovery_rate':.8}),('fee100w',{'vendor_fee':1000000}),
          ('prepay-and-deposit',{'vendor_prepay':1000000,'vendor_deposit':100000,'vendor_fee':300000}),
          ('own20w',{'owner_cash':200000}),('late-recovery',{'recovery_rate':.8,'collection_lag':2})]
cells={'owner_cash':'B4','recovery_rate':'B5','collection_lag':'B6','vendor_fee':'B7','vendor_prepay':'B8','vendor_deposit':'B9'}
out.mkdir(parents=True,exist_ok=True);records=[]
for name,changes in variants:
    book=openpyxl.load_workbook(args.workbook)
    for key,value in changes.items():book['Assumptions'][cells[key]]=value
    target=out/f'{name}.xlsx';book.save(target)
    values=projected(data,data['scenarios'][1],**changes)
    expected={k:values[k] for k in ['required_additional_funding','proposed_funding','ending_cash_with_proposed_funding']}
    records.append({'name':name,'path':str(target),'changes':changes,'expected':expected})
(out/'perturbations.json').write_text(json.dumps(records,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'copies':len(records),'manifest':str(out/'perturbations.json'),'status':'Requires native recalculation'},ensure_ascii=False))
