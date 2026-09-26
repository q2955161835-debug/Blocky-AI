import {it,expect} from 'vitest';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
it('installs the pinned desktop worker beside release binaries and rejects destinations outside the workspace',async()=>{
 const directory=await mkdtemp(resolve('try/desktop-assets-'));
 try {
  const installed=spawnSync(process.execPath,['scripts/install-runtime-worker.mjs',directory],{encoding:'utf8',windowsHide:true});
  expect(installed.status,installed.stderr).toBe(0);
  const bytes=await readFile(join(directory,'cli/runtime-worker.mjs'));
  const lock=JSON.parse(await readFile('tools/blocky-cli/runtime-worker-lock.json','utf8'));
  expect(bytes.length).toBe(lock.bytes);
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(lock.sha256);
  const rejected=spawnSync(process.execPath,['scripts/install-runtime-worker.mjs',resolve('..')],{encoding:'utf8',windowsHide:true});
  expect(rejected.status).not.toBe(0);
 } finally {await rm(directory,{recursive:true,force:true});}
});
