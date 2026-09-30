import {readFile,writeFile,readdir,mkdir,rm} from 'node:fs/promises';
import {resolve,dirname,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {projectRoot,runtimeSource,safeDirectory,verifyRuntime} from './build-document-parser.mjs';
export async function installDocumentParser(target){
  if(!target)throw Error('Document install requires a project target');
  const source=await safeDirectory(runtimeSource),lock=JSON.parse(await readFile(resolve(projectRoot,'packages/document-parser/runtime-lock.json'),'utf8'));
  await verifyRuntime(source,lock);
  const output=await safeDirectory(resolve(target,'document-parser'));
  if(output===source||source.startsWith(output+sep)||output.startsWith(source+sep))throw Error('Document install target conflicts with source');
  if((await readdir(output)).length){const previous=JSON.parse(await readFile(resolve(output,'runtime-lock.json'),'utf8'));await verifyRuntime(output,previous);await rm(output,{recursive:true});await safeDirectory(output);}
  for(const file of lock.files){const path=resolve(output,file.name);await mkdir(dirname(path),{recursive:true});await writeFile(path,await readFile(resolve(source,file.name)));}
  await writeFile(resolve(output,'runtime-lock.json'),JSON.stringify(lock,null,2)+'\n');
  const actual=await verifyRuntime(output,lock);return {directory:output,files:actual.files.length+1,directories:actual.directories,bytes:actual.files.reduce((n,f)=>n+f.bytes,0)};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)console.log(JSON.stringify(await installDocumentParser(process.argv[2])));
