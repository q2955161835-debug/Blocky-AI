"""Remove unused template payload and path-bearing image descriptions, preserving active parts."""
import sys,zipfile,posixpath,datetime,json
from pathlib import Path
from lxml import etree as E
f=Path(sys.argv[1]);R='http://schemas.openxmlformats.org/package/2006/relationships';W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';RR='http://schemas.openxmlformats.org/officeDocument/2006/relationships';CT='http://schemas.openxmlformats.org/package/2006/content-types'
with zipfile.ZipFile(f) as z: parts={n:z.read(n) for n in z.namelist()}
removed=[]
for n in list(parts):
 if n.startswith('customXml/') or n.startswith('xl/webextensions/') or n=='docProps/custom.xml':removed.append(n);parts.pop(n)
for n in list(parts):
 if not n.endswith('.rels'):continue
 r=E.fromstring(parts[n]);src=n.replace('/_rels/','/').removesuffix('.rels') if n!='_rels/.rels' else ''
 refs=set()
 if src in parts:
  sr=E.fromstring(parts[src]);refs=set(sr.xpath('.//@r:id | .//@r:embed | .//@r:link',namespaces={'r':RR}))
 changed=False
 for rel in list(r):
  typ=rel.get('Type','');target=rel.get('Target','');rid=rel.get('Id');resolved=posixpath.normpath(posixpath.join(posixpath.dirname(src),target))
  if typ.endswith('/customXml') or typ.endswith('/custom-properties') or resolved in removed or (typ.endswith('/hyperlink') and rid not in refs) or (typ.endswith('/image') and src.startswith('word/') and rid not in refs):
   r.remove(rel);changed=True
   if typ.endswith('/image') and resolved in parts:removed.append(resolved);parts.pop(resolved)
 if changed:parts[n]=E.tostring(r,xml_declaration=True,encoding='UTF-8',standalone=True)
for n in list(parts):
 if n.startswith('ppt/slides/') and n.endswith('.xml'):
  r=E.fromstring(parts[n])
  for e in r.iter():
   if E.QName(e).localname=='cNvPr' and any(v in e.get('descr','') for v in ['/workspace/','C:','D:']):
    e.set('descr','Blocky概念插画或Windows真实产品画面；具体来源与边界见本页讲稿')
  if n=='ppt/slides/slide8.xml':
   pics=r.xpath('.//p:pic',namespaces={'p':'http://schemas.openxmlformats.org/presentationml/2006/main'})
   A='http://schemas.openxmlformats.org/drawingml/2006/main'
   for pic,crop in zip(pics,[{'l':'29861','t':'31111','r':'37500','b':'20000'},{'l':'76042','t':'28889','r':'1042','b':'15556'}]):
    fill=pic.find('{http://schemas.openxmlformats.org/presentationml/2006/main}blipFill');old=fill.find('{'+A+'}srcRect')
    if old is not None:fill.remove(old)
    fill.insert(1,E.Element('{'+A+'}srcRect',crop))
  parts[n]=E.tostring(r,xml_declaration=True,encoding='UTF-8',standalone=True)
if 'xl/workbook.xml' in parts:
 r=E.fromstring(parts['xl/workbook.xml'])
 for e in list(r.iter()):
  if E.QName(e).localname=='absPath':
   parent=e.getparent();grand=parent.getparent()
   if E.QName(parent).localname=='Choice' and E.QName(grand).localname=='AlternateContent':grand.getparent().remove(grand)
   else:parent.remove(e)
 parts['xl/workbook.xml']=E.tostring(r,xml_declaration=True,encoding='UTF-8',standalone=True)
if '[Content_Types].xml' in parts:
 r=E.fromstring(parts['[Content_Types].xml'])
 for e in list(r):
  if e.get('PartName','').lstrip('/') in removed:r.remove(e)
 parts['[Content_Types].xml']=E.tostring(r,xml_declaration=True,encoding='UTF-8',standalone=True)
if 'docProps/core.xml' in parts:
 r=E.fromstring(parts['docProps/core.xml']);D='http://purl.org/dc/terms/';XSI='http://www.w3.org/2001/XMLSchema-instance'
 for name in ['created','modified']:
  e=r.find('{'+D+'}'+name)
  if e is None:e=E.SubElement(r,'{'+D+'}'+name)
  e.set('{'+XSI+'}type','dcterms:W3CDTF');e.text=datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
 parts['docProps/core.xml']=E.tostring(r,xml_declaration=True,encoding='UTF-8',standalone=True)
with zipfile.ZipFile(f,'w',zipfile.ZIP_DEFLATED) as z:
 for n,d in parts.items():z.writestr(n,d)
print(json.dumps({'file':str(f),'removed':removed},ensure_ascii=False))
