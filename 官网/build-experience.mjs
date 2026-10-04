import { build } from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
const out=path.join(root,'dist','studio');
await fs.mkdir(out,{recursive:true});
// Vendor Blockly's small visual resources locally; sound remains disabled.
const mediaSource=path.resolve(root,'../packages/ui-editor/node_modules/blockly/media');
const mediaTarget=path.join(root,'dist/assets/blockly-media');
await fs.mkdir(mediaTarget,{recursive:true});
for(const name of await fs.readdir(mediaSource))if(/\.(svg|png|gif|cur)$/.test(name))await fs.copyFile(path.join(mediaSource,name),path.join(mediaTarget,name));
const result=await build({entryPoints:[path.join(root,'experience','entry.tsx')],bundle:true,platform:'browser',format:'esm',target:'es2022',jsx:'automatic',minify:true,sourcemap:false,legalComments:'linked',outdir:out,entryNames:'app-[hash]',write:false,metafile:true,alias:{blockly:path.resolve(root,'../packages/ui-editor/node_modules/blockly')},define:{'process.env.NODE_ENV':'"production"'}});
// A dependency boundary: no desktop composition, Host, model, or worker is bundled.
const forbidden=Object.keys(result.metafile.inputs).filter(p=>/studio-host|studio-desktop\/src\/composition|tauri-apps|runtime-worker|builder\.mjs/.test(p.replaceAll('\\','/')));
if(forbidden.length)throw Error(`Unexpected desktop dependency: ${forbidden.join(', ')}`);
const current=new Set(result.outputFiles.map(f=>path.basename(f.path)));
for(const name of await fs.readdir(out))if(/^app-.*\.(js|css|txt)$/.test(name)&&!current.has(name))await fs.unlink(path.join(out,name));
for(const file of result.outputFiles)await fs.writeFile(file.path,file.contents);
const dependencyRoots=new Set(Object.keys(result.metafile.inputs).map(input=>input.replaceAll('\\','/').match(/^(.*node_modules\/\.pnpm\/[^/]+\/node_modules\/(?:@[^/]+\/)?[^/]+)/)?.[1]).filter(Boolean));
const notices=[];
for(const directory of dependencyRoots){
  const packageInfo=JSON.parse(await fs.readFile(path.join(directory,'package.json'),'utf8'));
  const licenses=(await fs.readdir(directory)).filter(name=>/^(license|licence|notice)(\.|$)/i.test(name));
  if(!licenses.length){
    if(packageInfo.name==='blockly'&&packageInfo.version==='13.2.1'){
      notices.push(`blockly 13.2.1\n${await fs.readFile(path.join(root,'experience/LICENSE.blockly.txt'),'utf8')}`);
      continue;
    }
    throw Error(`License missing: ${packageInfo.name}`);
  }
  for(const name of licenses)notices.push(`${packageInfo.name} ${packageInfo.version}\n${await fs.readFile(path.join(directory,name),'utf8')}`);
}
await fs.writeFile(path.join(out,'licenses.txt'),notices.join('\n\n--------------------\n\n'));
const js=result.outputFiles.find(f=>f.path.endsWith('.js')),css=result.outputFiles.find(f=>f.path.endsWith('.css'));
await fs.writeFile(path.join(out,'index.html'),`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; media-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><title>Blocky Studio · 在线体验</title><meta name="theme-color" content="#20242c"><script src="../preferences-boot.js"></script><link rel="stylesheet" href="./${path.basename(css.path)}"><script type="module" src="./${path.basename(js.path)}"></script></head><body><div id="root"></div></body></html>`);
await fs.mkdir(path.resolve(root,'../try/官网工作演示'),{recursive:true});
await fs.writeFile(path.resolve(root,'../try/官网工作演示/experience-build.json'),JSON.stringify(result.metafile,null,2));
console.log(`Built ${result.outputFiles.length} assets; desktop capability boundary checked.`);
