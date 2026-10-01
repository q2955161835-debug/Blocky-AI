import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, rm, symlink, link } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { audioRoot, verifyAudioRuntime } from '../../scripts/prepare-audio-runtime.mjs';
import { installAudioRuntime } from '../../scripts/install-audio-runtime.mjs';

async function temporary(fn) {
  const parent = resolve(audioRoot, 'try/agent-capability-upgrade/audio-deployment-tests');
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(resolve(parent, 'runtime-'));
  try { await fn(directory); } finally { await rm(directory, { recursive: true, force: true }); }
}
async function fixture(directory) {
  const source = resolve(directory, 'source');
  const payloads = { 'whisper-cli.exe': 'synthetic fixture bytes, never executed', 'licenses/LICENSE.Whisper': 'synthetic legal fixture' };
  const lock = { schemaVersion: 'blocky.audio-runtime/v1', platform: 'windows-x64', files: [] };
  for (const [name, text] of Object.entries(payloads)) {
    await mkdir(dirname(resolve(source, name)), { recursive: true });
    const bytes = Buffer.from(text);
    await writeFile(resolve(source, name), bytes);
    lock.files.push({ name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  await writeFile(resolve(source, 'runtime-lock.json'), JSON.stringify(lock));
  return { source, lock };
}
test('offline audio installation verifies and preserves exact payload, licenses and idempotence', () => temporary(async directory => {
  const options = await fixture(directory), target = resolve(directory, 'native');
  assert.equal((await installAudioRuntime(target, options)).files, 3);
  assert.equal((await installAudioRuntime(target, options)).files, 3);
  for (const file of options.lock.files) assert.deepEqual(await readFile(resolve(target, 'audio-runtime', file.name)), await readFile(resolve(options.source, file.name)));
  await writeFile(resolve(options.source, 'whisper-cli.exe'), 'corrupt');
  await assert.rejects(installAudioRuntime(target, options), /size mismatch/);
  await verifyAudioRuntime(resolve(target, 'audio-runtime'), options.lock);
}));
test('changed installation, unknown inventory and altered manifest never get overwritten', () => temporary(async directory => {
  const options = await fixture(directory), target = resolve(directory, 'native');
  await installAudioRuntime(target, options);
  const executable = resolve(target, 'audio-runtime/whisper-cli.exe');
  await writeFile(executable, 'damaged');
  await assert.rejects(installAudioRuntime(target, options), /size mismatch/);
  assert.equal(await readFile(executable, 'utf8'), 'damaged');
  await writeFile(executable, await readFile(resolve(options.source, 'whisper-cli.exe')));
  await writeFile(resolve(target, 'audio-runtime/unexpected.txt'), 'unexpected');
  await assert.rejects(verifyAudioRuntime(resolve(target, 'audio-runtime'), options.lock), /inventory mismatch/);
  await rm(resolve(target, 'audio-runtime/unexpected.txt'));
  await writeFile(resolve(target, 'audio-runtime/runtime-lock.json'), JSON.stringify({ ...options.lock, files: [] }));
  await assert.rejects(verifyAudioRuntime(resolve(target, 'audio-runtime'), options.lock), /manifest mismatch/);
}));
test('audio installation rejects outside paths, source overlap and linked source/destination', () => temporary(async directory => {
  const options = await fixture(directory);
  await assert.rejects(installAudioRuntime(resolve(audioRoot, '..'), options), /stay in project/);
  await assert.rejects(installAudioRuntime(options.source, options), /conflicts/);
  await rm(resolve(options.source, 'audio-runtime'), { recursive: true });
  const linked = resolve(directory, 'linked');
  await symlink(options.source, linked, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(installAudioRuntime(resolve(directory, 'native'), { ...options, source: linked }), /links/);
  const target = resolve(directory, 'destination');
  await mkdir(target);
  await symlink(options.source, resolve(target, 'audio-runtime'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(installAudioRuntime(target, options), /links/);
}));
test('audio audit rejects hardlinked executable and hardlinked manifest', () => temporary(async directory => {
  const options = await fixture(directory);
  const executable = resolve(options.source, 'whisper-cli.exe'), executableAlias = resolve(directory, 'executable-alias');
  await link(executable, executableAlias);
  await assert.rejects(verifyAudioRuntime(options.source, options.lock), /links/);
  await rm(executableAlias);
  await link(resolve(options.source, 'runtime-lock.json'), resolve(directory, 'manifest-alias'));
  await assert.rejects(verifyAudioRuntime(options.source, options.lock), /manifest.*links/);
}));
test('audio audit enforces locked platform, paths, inventory count and aggregate byte bounds', () => temporary(async directory => {
  const options = await fixture(directory);
  for (const lock of [
    { ...options.lock, platform: 'linux-x64' },
    { ...options.lock, files: [{ ...options.lock.files[0], name: '../outside' }] },
    { ...options.lock, files: Array(17).fill(options.lock.files[0]) },
    { ...options.lock, files: [{ ...options.lock.files[0], bytes: 97 * 1024 * 1024 }] },
  ]) await assert.rejects(verifyAudioRuntime(options.source, lock), /manifest invalid|exceeds bounds/);
}));
