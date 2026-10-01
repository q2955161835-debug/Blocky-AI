import { readFile, writeFile, readdir } from 'node:fs/promises';
import { resolve, dirname, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { safeDirectory } from './build-document-parser.mjs';
import { audioLock, audioRuntimeSource, prepareAudioRuntime, verifyAudioRuntime } from './prepare-audio-runtime.mjs';

export async function installAudioRuntime(target, { source = audioRuntimeSource, lock = audioLock } = {}) {
  if (!target) throw Error('Audio install requires a project target');
  const output = await safeDirectory(resolve(target, 'audio-runtime'));
  source = resolve(source);
  if (output === source || output.startsWith(source + sep) || source.startsWith(output + sep)) throw Error('Audio install target conflicts with source');
  if (source === audioRuntimeSource && lock === audioLock) await prepareAudioRuntime();
  else await verifyAudioRuntime(source, lock);
  if ((await readdir(output)).length) return verifyAudioRuntime(output, lock);
  for (const file of lock.files) {
    await safeDirectory(dirname(resolve(output, file.name)));
    await writeFile(resolve(output, file.name), await readFile(resolve(source, file.name)), { flag: 'wx' });
  }
  await writeFile(resolve(output, 'runtime-lock.json'), JSON.stringify(lock, null, 2) + '\n', { flag: 'wx' });
  return verifyAudioRuntime(output, lock);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) console.log(JSON.stringify(await installAudioRuntime(process.argv[2])));
