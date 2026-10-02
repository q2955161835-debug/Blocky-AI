"""Refresh the true TOC field cache from heading styles and measured PDF pagination."""
import sys,re,copy,zipfile,subprocess
from pathlib import Path
from lxml import etree as E
f=Path(sys.argv[1]);pdf=Path(sys.argv[2]);txt=subprocess.check_output(['pdftotext','-layout',str(pdf),'-']).decode();pages=txt.split('\f');ns={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main'};W=ns['w'];q=lambda x:'{'+W+'}'+x
with zipfile.ZipFile(f) as z: parts={n:z.read(n) for n in z.namelist()}
r=E.fromstring(parts['word/document.xml']);body=r.find('w:body',ns);styles=E.fromstring(parts['word/styles.xml']);entries=[]
normalize=lambda t:re.sub(r'\s+','',t)
for j,node in enumerate(body.findall('w:p',ns)):
 style=node.xpath('string(w:pPr/w:pStyle/@w:val)',namespaces=ns)
 if style not in ['Heading1','Heading2','Heading3']:continue
 t=''.join(node.xpath('.//w:t/text()',namespaces=ns)); matches=[i+1 for i,pg in enumerate(pages) if normalize(t) in normalize(pg)]
 if not matches:raise ValueError('Heading page unavailable: '+t)
 name='_TocBlocky'+str(len(entries));bid=str(1000+len(entries));
 for old in node.findall('w:bookmarkStart',ns)+node.findall('w:bookmarkEnd',ns):node.remove(old)
 start=E.Element(q('bookmarkStart'),{q('id'):bid,q('name'):name});end=E.Element(q('bookmarkEnd'),{q('id'):bid});node.insert(1,start);node.append(end);entries.append((t,style[-1],matches[0],name))
field=next(n for n in body.findall('w:p',ns) if n.xpath('.//w:instrText[contains(.,"TOC")]',namespaces=ns));idx=body.index(field);body.remove(field)
def run(parent,text=None,kind=None,instr=None):
 a=E.SubElement(parent,q('r'))
 if text is not None:E.SubElement(a,q('t')).text=text
 if kind:E.SubElement(a,q('fldChar'),{q('fldCharType'):kind})
 if instr:E.SubElement(a,q('instrText')).text=instr
 return a
nodes=[]
for i,(t,lv,pg,name) in enumerate(entries):
 para=E.Element(q('p'));pp=E.SubElement(para,q('pPr'));E.SubElement(pp,q('pStyle'),{q('val'):'TOC'+lv});
 if i==0:run(para,kind='begin');run(para,instr=' TOC \\o "1-3" \\h \\z \\u ');run(para,kind='separate')
 run(para,'\ufeff'+t);E.SubElement(run(para),q('tab'));run(para,kind='begin');run(para,instr=' PAGEREF '+name+' \\h ');run(para,kind='separate');run(para,str(pg));run(para,kind='end');
 if i==len(entries)-1:run(para,kind='end')
 nodes.append(para)
for i,node in enumerate(nodes):body.insert(idx+i,node)
for lv in ['1','2','3']:
 st=styles.xpath(f'.//w:style[@w:styleId="TOC{lv}"]',namespaces=ns)[0];pp=st.find('w:pPr',ns)
 if pp is None:pp=E.SubElement(st,q('pPr'))
 sp=pp.find('w:spacing',ns)
 if sp is None:sp=E.SubElement(pp,q('spacing'))
 sp.attrib.update({q('before'):'0',q('after'):'30',q('line'):'240',q('lineRule'):'auto'})
 tabs=pp.find('w:tabs',ns)
 if tabs is not None:pp.remove(tabs)
 tabs=E.SubElement(pp,q('tabs'));E.SubElement(tabs,q('tab'),{q('val'):'right',q('leader'):'dot',q('pos'):'9026'})
 rp=st.find('w:rPr',ns)
 if rp is None:rp=E.SubElement(st,q('rPr'))
 for tag in ['sz','szCs']:
  e=rp.find('w:'+tag,ns)
  if e is None:e=E.SubElement(rp,q(tag))
  e.set(q('val'),'20')
parts['word/document.xml']=E.tostring(r,xml_declaration=True,encoding='UTF-8',standalone=True);parts['word/styles.xml']=E.tostring(styles,xml_declaration=True,encoding='UTF-8',standalone=True)
with zipfile.ZipFile(f,'w',zipfile.ZIP_DEFLATED) as z:
 for n,data in parts.items():z.writestr(n,data)
print(entries)
