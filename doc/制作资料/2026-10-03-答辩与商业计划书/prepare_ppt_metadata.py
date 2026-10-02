import sys,zipfile,os,json,struct
from pathlib import Path
from lxml import etree as E
p=Path(sys.argv[1]); out=p.with_suffix('.metadata.tmp')
ns={'dc':'http://purl.org/dc/elements/1.1/','cp':'http://schemas.openxmlformats.org/package/2006/metadata/core-properties'}
crops=json.loads(Path(sys.argv[2]).read_text('utf-8')) if len(sys.argv)>2 else []
nsd={'a':'http://schemas.openxmlformats.org/drawingml/2006/main','p':'http://schemas.openxmlformats.org/presentationml/2006/main'}
with zipfile.ZipFile(p) as z,zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as w:
    for n in z.namelist():
        b=z.read(n)
        if n=='docProps/core.xml':
            r=E.fromstring(b)
            for tag,value in [('dc:creator','Blocky Studio'),('cp:lastModifiedBy','Blocky Studio'),('dc:title','Blocky Studio 新版答辩'),('dc:subject','教育 AI 创作与机构服务')]:
                el=r.find(tag,ns)
                if el is None:
                    prefix,key=tag.split(':');el=E.SubElement(r,'{'+ns[prefix]+'}'+key)
                el.text=value
            b=E.tostring(r,xml_declaration=True,encoding='UTF-8',standalone=True)
        edits=[c for c in crops if n==f"ppt/slides/slide{c['slide']}.xml"]
        if edits:
            r=E.fromstring(b); pics=r.findall('.//p:pic',nsd)
            for c in edits:
                pic=pics[c['picture']]; fill=pic.find('p:blipFill',nsd)
                for old in fill.findall('a:srcRect',nsd): fill.remove(old)
                q=E.Element('{'+nsd['a']+'}srcRect')
                for key,longkey in [('l','left'),('t','top'),('r','right'),('b','bottom')]: q.set(key,str(round(c['crop'][longkey]*100000)))
                fill.insert(1,q)
                with open(c['file'],'rb') as f: header=f.read(24)
                iw,ih=struct.unpack('>II',header[16:24]); cr=c['crop']; fw,fh=c['frame']['width'],c['frame']['height']
                sw,sh=iw*(1-cr['left']-cr['right']),ih*(1-cr['top']-cr['bottom'])
                scale=min(fw/sw,fh/sh); width,height=sw*scale,sh*scale
                x=c['frame']['left']+(fw-width)/2;y=c['frame']['top']+(fh-height)/2
                xf=pic.find('p:spPr/a:xfrm',nsd); off=xf.find('a:off',nsd); ext=xf.find('a:ext',nsd)
                off.set('x',str(round(x*9525)));off.set('y',str(round(y*9525)));ext.set('cx',str(round(width*9525)));ext.set('cy',str(round(height*9525)))
            b=E.tostring(r,xml_declaration=True,encoding='UTF-8',standalone=True)
        w.writestr(n,b)
os.replace(out,p)
