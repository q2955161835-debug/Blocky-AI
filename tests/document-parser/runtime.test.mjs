import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {safeDirectory,inventory,verifyRuntime,digest,projectRoot} from '../../scripts/build-document-parser.mjs';
test('runtime verification rejects modified bytes, missing files and extra files',async()=>{
  const base=resolve(projectRoot,'try/agent-capability-upgrade/document-parser-tests');await mkdir(base,{recursive:true});const dir=await mkdtemp(resolve(base,'verify-'));
  const bytes=Buffer.from('synthetic runtime');await writeFile(resolve(dir,'worker.mjs'),bytes);
  const lock={schemaVersion:'blocky.document-runtime/v1',files:[{name:'worker.mjs',bytes:bytes.length,sha256:digest(bytes)}]};
  await verifyRuntime(dir,lock);
  await writeFile(resolve(dir,'worker.mjs'),'changed');await assert.rejects(verifyRuntime(dir,lock),/failed verification/);
  await writeFile(resolve(dir,'worker.mjs'),bytes);await writeFile(resolve(dir,'unlisted.txt'),'x');await assert.rejects(verifyRuntime(dir,lock),/failed verification/);
  await assert.rejects(verifyRuntime(dir,{...lock,files:[{...lock.files[0],name:'../escape'}]}),/Invalid/);
});
test('build/install directory boundary refuses workspace exterior before creating it',async()=>{
  await assert.rejects(safeDirectory(resolve(projectRoot,'..','outside-document-probe')),/stay in project/);
});
