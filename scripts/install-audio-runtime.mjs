import { readFile, writeFile, readdir } from 'node:fs/promises';
import { resolve, dirname, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { safeDirectory } from './build-document-parser.mjs';
import { audioLock, audioRuntimeSource, prepareAudioRuntime, verifyAudioRuntime } from './prepare-audio-runtime.mjs';

export async function installAudioRuntime(target) {
  if (!target) throw Error('Audio install requires a project target');
  const output = await safeDirectory(resolve(target, 'audio-runtime'));
  if (output === audioRuntimeSource || output.startsWith(audioRuntimeSource + sep) || audioRuntimeSource.startsWith(output + sep)) throw Error('Audio install target conflicts with source');
  await prepareAudioRuntime();
  if ((await readdir(output)).length) return verifyAudioRuntime(output);
  for (const file of audioLock.files) {
    await safeDirectory(dirname(resolve(output, file.name)));
    await writeFile(resolve(output, file.name), await readFile(resolve(audioRuntimeSource, file.name)), { flag: 'wx' });
  }
  await writeFile(resolve(output, 'runtime-lock.json'), JSON.stringify(audioLock, null, 2) + '\n', { flag: 'wx' });
  return verifyAudioRuntime(output);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) console.log(JSON.stringify(await installAudioRuntime(process.argv[2])));
