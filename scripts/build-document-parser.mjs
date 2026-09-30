import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {readFile,writeFile,readdir,mkdir,lstat,realpath,rm} from 'node:fs/promises';
import {resolve,dirname,relative,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {writeGenerated} from './write-generated.mjs';
export const projectRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export const runtimeSource=resolve(projectRoot,'try/agent-capability-upgrade/document-runtime');
export const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const schemaVersion='blocky.document-runtime/v1';
export async function safeDirectory(target){
  target=resolve(target);if(!target.startsWith(projectRoot+sep))throw Error('Document target must stay in project');
  let current=projectRoot;
  for(const part of relative(projectRoot,target).split(sep)){
    current=resolve(current,part);await mkdir(current).catch(e=>{if(e.code!=='EEXIST')throw e;});
    const info=await lstat(current);if(!info.isDirectory()||info.isSymbolicLink()||await realpath(current)!==current)throw Error('Document target must not contain links');
  }return target;
}
export async function inventory(directory){const files=[];let directories=0;
  async function visit(path){for(const entry of await readdir(path,{withFileTypes:true})){const next=resolve(path,entry.name),info=await lstat(next);
    if(info.isSymbolicLink()||(!info.isDirectory()&&!info.isFile())||(info.isFile()&&info.nlink>1))throw Error('Document runtime must contain regular owned files');
    if(info.isDirectory()){directories++;await visit(next);}else{const name=relative(directory,next).split(sep).join('/');if(name==='runtime-lock.json')continue;const bytes=await readFile(next);files.push({name,bytes:bytes.length,sha256:digest(bytes)});}
  }}await visit(directory);files.sort((a,b)=>a.name.localeCompare(b.name,'en'));return {files,directories};
}
export async function verifyRuntime(directory,lock){
  if(lock.schemaVersion!==schemaVersion||!Array.isArray(lock.files)||!lock.files.length)throw Error('Invalid document runtime manifest');
  const names=new Set();for(const item of lock.files){if(typeof item.name!=='string'||!/^[a-zA-Z0-9@_.\/-]+$/.test(item.name)||item.name.split('/').some(v=>!v||v==='.'||v==='..')||item.name==='runtime-lock.json'||names.has(item.name.toLowerCase())||!Number.isSafeInteger(item.bytes)||item.bytes<0||!/^[a-f0-9]{64}$/.test(item.sha256))throw Error('Invalid document runtime manifest');names.add(item.name.toLowerCase());}
  const actual=await inventory(directory);if(JSON.stringify(actual.files)!==JSON.stringify([...lock.files].sort((a,b)=>a.name.localeCompare(b.name,'en'))))throw Error('Document runtime failed verification');
  if(actual.files.length+1>3500||actual.files.length+actual.directories+1>4096||actual.files.reduce((n,f)=>n+f.bytes,0)>256*1024*1024)throw Error('Document runtime exceeds bounds');
  return actual;
}
async function packagePath(name,from){const require=createRequire(resolve(from,'package.json'));
  try{return await realpath(dirname(require.resolve(name+'/package.json')));}catch{let path=dirname(require.resolve(name));for(;;){try{if(JSON.parse(await readFile(resolve(path,'package.json'))).name===name)return await realpath(path);}catch{}const next=dirname(path);if(next===path)throw Error('Dependency not found');path=next;}}
}
function retain(name,pkg){
  const lower=name.toLowerCase();
  if(/(^|\/)(licenses?|copying|notices?|third[-_]?party[-_]?notices?)(\/|\.|$)/i.test(name)||/(^|\/)(license[^/]*|copying[^/]*|notice[^/]*)$/i.test(name))return true;
  if(name==='package.json')return true;
  if(pkg==='pdfjs-dist')return /^(legacy\/build\/(pdf|pdf.worker)\.mjs|cmaps\/.*\.bcmap|standard_fonts\/|wasm\/)/.test(name)&&!lower.endsWith('.map');
  if(pkg==='exceljs')return name==='excel.js'||name.startsWith('lib/');
  if(pkg==='tesseract.js')return name.startsWith('src/')||name==='index.js';
  if(pkg==='tesseract.js-core')return /\.(js|wasm)$/.test(name);
  if(/(^|\/)(test|tests|__tests__|docs?|examples?|benchmarks?|coverage|\.github|\.vscode)(\/|$)/i.test(name)||lower.endsWith('.map')||lower.endsWith('.d.ts'))return false;
  return /\.(js|cjs|mjs|json|node|wasm|dat|xml|txt|bin)$/.test(lower);
}
export async function buildDocumentParser(output=runtimeSource){
  output=await safeDirectory(output);
  const old=await readdir(output);
  if(old.length){const lock=JSON.parse(await readFile(resolve(output,'runtime-lock.json'),'utf8'));await verifyRuntime(output,lock);await rm(output,{recursive:true});await safeDirectory(output);}
  const packageRoot=resolve(projectRoot,'packages/document-parser'),pkg=JSON.parse(await readFile(resolve(packageRoot,'package.json'))),graph=new Map(),globals=new Map();
  async function visit(name,from){const source=await packagePath(name,from);if(graph.has(source))return graph.get(source);
    const metadata=JSON.parse(await readFile(resolve(source,'package.json'))),node={source,metadata,dependencies:new Map()};graph.set(source,node);if(!globals.has(name))globals.set(name,node);
    for(const dependency of Object.keys(metadata.dependencies??{}))node.dependencies.set(dependency,await visit(dependency,source));
    for(const dependency of Object.keys(metadata.optionalDependencies??{})){try{node.dependencies.set(dependency,await visit(dependency,source));}catch{}}
    return node;
  }
  for(const [name,version] of Object.entries(pkg.dependencies)){const node=await visit(name,packageRoot);if(node.metadata.version!==version)throw Error('Document dependency version mismatch');}
  async function copyTree(source,target,pkgName,base=source){for(const entry of await readdir(source,{withFileTypes:true})){if(entry.name==='node_modules')continue;const path=resolve(source,entry.name),name=relative(base,path).split(sep).join('/');
    if(entry.isSymbolicLink())throw Error('Dependency contains unsupported link');if(entry.isDirectory())await copyTree(path,resolve(target,entry.name),pkgName,base);else if(entry.isFile()&&retain(name,pkgName)){await mkdir(target,{recursive:true});await writeFile(resolve(target,entry.name),await readFile(path));}
  }}
  const placed=new Set();
  async function place(node,target,visible){if(placed.has(target))return;placed.add(target);await copyTree(node.source,target,node.metadata.name);
    const environment=new Map(visible);environment.set(node.metadata.name,node);
    // Install all immediate conflicts before recursing. Each package resolves
    // the versions supplied by its original pnpm dependency graph, without links.
    const nested=[];for(const [name,dependency] of node.dependencies){if(environment.get(name)!==dependency){environment.set(name,dependency);nested.push([dependency,resolve(target,'node_modules',name)]);}}
    for(const [dependency,path] of nested)await place(dependency,path,environment);
  }
  for(const [name,node] of globals)await place(node,resolve(output,'node_modules',name),globals);
  for(const entry of await readdir(packageRoot)){if(entry.endsWith('.mjs'))await writeFile(resolve(output,entry),await readFile(resolve(packageRoot,entry)));}
  await writeFile(resolve(output,'package.json'),JSON.stringify({type:'module',private:true})+'\n');
  const nodePath=resolve(projectRoot,'try/stage5/builder-runtime/node.exe'),nodeBytes=await readFile(nodePath);
  if(nodeBytes.length!==86989128||digest(nodeBytes)!=='f8d162c0641dcee512132f3bcf8a68169c7ecb852efd8e1a46c9fec5a0f469ed')throw Error('Pinned Node failed verification');
  await writeFile(resolve(output,'node.exe'),nodeBytes);
  const languageHashes={eng:'45b4cb346724ac1774f1c36f42f182b887bcdb28ebe63e6fff90ac41f3fcff91',chi_sim:'b8a23f10c7de500891eb458a8adc9cc58ab7f242f08b7d149f5e9aea4ad5db7c'};
  await mkdir(resolve(output,'runtime/langs'),{recursive:true});
  for(const [lang,hash] of Object.entries(languageHashes)){const from=await packagePath('@tesseract.js-data/'+lang,packageRoot),bytes=await readFile(resolve(from,'4.0.0_best_int',lang+'.traineddata.gz'));if(digest(bytes)!==hash)throw Error('Pinned language asset failed verification');await writeFile(resolve(output,'runtime/langs',lang+'.traineddata.gz'),bytes);
    for(const file of await readdir(from))if(/^license/i.test(file))await writeFile(resolve(output,'runtime/langs',lang+'-'+file),await readFile(resolve(from,file)));
  }
  const actual=await inventory(output),lock={schemaVersion,files:actual.files};
  await writeFile(resolve(output,'runtime-lock.json'),JSON.stringify(lock,null,2)+'\n');await verifyRuntime(output,lock);
  await writeGenerated(resolve(packageRoot,'runtime-lock.json'),JSON.stringify(lock,null,2)+'\n');
  return {directory:output,files:actual.files.length+1,directories:actual.directories,bytes:actual.files.reduce((n,f)=>n+f.bytes,0)};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)console.log(JSON.stringify(await buildDocumentParser(process.argv[2])));
