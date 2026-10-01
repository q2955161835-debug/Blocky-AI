import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { root } from './prepare-knowledge-model.mjs';
async function temporary(fn) {
  const parent = join(root, 'try/agent-capability-upgrade/knowledge-deployment-tests');
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(join(parent, 'install-'));
  try { await fn(directory); } finally { await rm(directory, { recursive: true, force: true }); }
}
const locked = bytes => ({ bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
test('model deployment publishes exact locked model assets, and refuses changed source bytes', () => temporary(async directory => {
  const module = await import('./install-knowledge-models.mjs').catch(() => ({}));
  assert.equal(typeof module.installModelAssets, 'function', 'shared model deployment is missing');
  const source = join(directory, 'cache'); const target = join(directory, 'native');
  await mkdir(join(source, 'minilm'), { recursive: true });
  const model = Buffer.from('synthetic ONNX bytes');
  await writeFile(join(source, 'minilm/model.onnx'), model);
  const definition = { directory: 'minilm', files: [{ name: 'model.onnx', ...locked(model) }] };
  await module.installModelAssets(target, [definition], source);
  assert.deepEqual(await readFile(join(target, 'models/minilm/model.onnx')), model);
  await writeFile(join(source, 'minilm/model.onnx'), 'changed');
  await assert.rejects(module.installModelAssets(target, [definition], source), /size mismatch|checksum mismatch/);
  assert.deepEqual(await readFile(join(target, 'models/minilm/model.onnx')), model);
}));
test('model deployment rejects linked destination directories before copying', () => temporary(async directory => {
  const module = await import('./install-knowledge-models.mjs').catch(() => ({}));
  assert.equal(typeof module.installModelAssets, 'function', 'shared model deployment is missing');
  await mkdir(join(directory, 'external')); await mkdir(join(directory, 'native'));
  await symlink(join(directory, 'external'), join(directory, 'native/models'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(module.installModelAssets(join(directory, 'native'), [{ directory: 'minilm', files: [] }], directory), /links/);
}));
test('model deployment rejects linked source model directories before reading assets', () => temporary(async directory => {
  const { installModelAssets } = await import('./install-knowledge-models.mjs');
  const source = join(directory, 'cache'), external = join(directory, 'external'), target = join(directory, 'native');
  await mkdir(source); await mkdir(external);
  const model = Buffer.from('synthetic ONNX bytes');
  await writeFile(join(external, 'model.onnx'), model);
  await symlink(external, join(source, 'minilm'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(installModelAssets(target, [{directory:'minilm',files:[{name:'model.onnx',...locked(model)}]}], source), /links/);
}));
