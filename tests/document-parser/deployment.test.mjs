import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, rm, readdir, symlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buildDocumentParser, verifyRuntime, digest, projectRoot } from '../../scripts/build-document-parser.mjs';

async function temporary(fn) {
  const parent = resolve(projectRoot, 'try/agent-capability-upgrade/document-deployment-tests');
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(resolve(parent, 'runtime-'));
  try { await fn(directory); } finally { await rm(directory, { recursive: true, force: true }); }
}

test('Windows document build refuses a different host before touching existing artifacts', { skip: process.platform === 'win32' && process.arch === 'x64' }, () => temporary(async directory => {
  const before = await readFile(resolve(projectRoot, 'packages/document-parser/runtime-lock.json'));
  await writeFile(resolve(directory, 'keep.txt'), 'existing artifact');
  await assert.rejects(buildDocumentParser(directory), /Windows x64/);
  assert.deepEqual(await readdir(directory), ['keep.txt']);
  assert.equal(await readFile(resolve(directory, 'keep.txt'), 'utf8'), 'existing artifact');
  assert.deepEqual(await readFile(resolve(projectRoot, 'packages/document-parser/runtime-lock.json')), before);
}));

test('hash-valid Linux canvas cannot be accepted as a Windows document runtime', () => temporary(async directory => {
  const name = 'node_modules/@napi-rs/canvas-linux-x64-gnu/skia.linux-x64-gnu.node';
  const bytes = Buffer.from('synthetic ELF native canvas');
  await mkdir(resolve(directory, 'node_modules/@napi-rs/canvas-linux-x64-gnu'), { recursive: true });
  await writeFile(resolve(directory, name), bytes);
  const lock = { schemaVersion: 'blocky.document-runtime/v1', files: [{ name, bytes: bytes.length, sha256: digest(bytes) }] };
  await assert.rejects(verifyRuntime(directory, lock), /Windows x64/);
}));

test('parser installation preserves the exact verified payload and refuses corruption before replacing it', () => temporary(async directory => {
  const { installDocumentParser } = await import('../../scripts/install-document-parser.mjs');
  const source = resolve(directory, 'source');
  await mkdir(source);
  const bytes = Buffer.from('pinned synthetic document worker');
  const lock = { schemaVersion: 'blocky.document-runtime/v1', files: [{ name: 'worker.mjs', bytes: bytes.length, sha256: digest(bytes) }] };
  await writeFile(resolve(source, 'worker.mjs'), bytes);
  const lockPath = resolve(source, 'runtime-lock.json');
  await writeFile(lockPath, JSON.stringify(lock));
  const target = resolve(directory, 'cli/bin');
  await installDocumentParser(target, { source, lockPath });
  assert.deepEqual(await readFile(resolve(target, 'document-parser/worker.mjs')), bytes);
  await verifyRuntime(resolve(target, 'document-parser'), lock);
  await writeFile(resolve(source, 'worker.mjs'), 'corrupt');
  await assert.rejects(installDocumentParser(target, { source, lockPath }), /failed verification/);
  assert.deepEqual(await readFile(resolve(target, 'document-parser/worker.mjs')), bytes);
}));

test('document notices verify every vendored native and WASM license before publishing', () => temporary(async directory => {
  const module = await import('../../scripts/document-runtime-licenses.mjs').catch(() => ({}));
  assert.equal(typeof module.loadDocumentLicenses, 'function', 'pinned native and WASM notices are missing');
  const source = resolve(projectRoot, 'vendor/licenses/document-runtime');
  const registry = JSON.parse(await readFile(resolve(source, 'registry.json'), 'utf8'));
  for (const license of registry.licenses) await writeFile(resolve(directory, license.file), await readFile(resolve(source, license.file)));
  await writeFile(resolve(directory, 'registry.json'), JSON.stringify(registry));
  const licenses = await module.loadDocumentLicenses(directory);
  assert(licenses.some(item => item.name === 'Skia'));
  assert(licenses.some(item => item.name === 'ICU'));
  assert(licenses.some(item => item.name === 'Leptonica'));
  assert(licenses.some(item => item.name === 'OCR-WASM'));
  await writeFile(resolve(directory, registry.licenses[0].file), 'altered legal text');
  await assert.rejects(module.loadDocumentLicenses(directory), /license.*verification/i);
}));

test('release enumeration verifies parser manifest and hashes before exposing package files', () => temporary(async directory => {
  const module = await import('../../scripts/install-document-parser.mjs');
  assert.equal(typeof module.documentRuntimeFiles, 'function', 'release parser verification is missing');
  const source = resolve(directory, 'source'); await mkdir(source);
  const bytes = Buffer.from('synthetic worker');
  const lock = { schemaVersion: 'blocky.document-runtime/v1', files: [{ name: 'worker.mjs', bytes: bytes.length, sha256: digest(bytes) }] };
  const lockPath = resolve(directory, 'checked-lock.json');
  await writeFile(lockPath, JSON.stringify(lock));
  await writeFile(resolve(source, 'runtime-lock.json'), JSON.stringify(lock));
  await writeFile(resolve(source, 'worker.mjs'), bytes);
  assert.deepEqual(await module.documentRuntimeFiles(source, lockPath), ['worker.mjs', 'runtime-lock.json']);
  await writeFile(resolve(source, 'worker.mjs'), 'unscanned changes');
  await assert.rejects(module.documentRuntimeFiles(source, lockPath), /failed verification/);
  await writeFile(resolve(source, 'worker.mjs'), bytes);
  await writeFile(resolve(source, 'runtime-lock.json'), JSON.stringify({ ...lock, files: [] }));
  await assert.rejects(module.documentRuntimeFiles(source, lockPath), /manifest mismatch/);
}));

test('canvas JavaScript without its Windows native payload cannot form a deployable runtime', () => temporary(async directory => {
  const name = 'node_modules/@napi-rs/canvas/package.json';
  const bytes = Buffer.from('{"name":"@napi-rs/canvas","version":"0.1.88"}');
  await mkdir(resolve(directory, 'node_modules/@napi-rs/canvas'), { recursive: true });
  await writeFile(resolve(directory, name), bytes);
  const lock = { schemaVersion: 'blocky.document-runtime/v1', files: [{ name, bytes: bytes.length, sha256: digest(bytes) }] };
  await assert.rejects(verifyRuntime(directory, lock), /Windows x64/);
}));


test('release parser enumeration rejects a linked runtime root', () => temporary(async directory => {
  const { documentRuntimeFiles } = await import('../../scripts/install-document-parser.mjs');
  const source = resolve(directory, 'source'); await mkdir(source);
  const bytes = Buffer.from('synthetic worker');
  const lock = { schemaVersion: 'blocky.document-runtime/v1', files: [{ name: 'worker.mjs', bytes: bytes.length, sha256: digest(bytes) }] };
  const lockPath = resolve(directory, 'checked-lock.json');
  await writeFile(lockPath, JSON.stringify(lock));
  await writeFile(resolve(source, 'runtime-lock.json'), JSON.stringify(lock));
  await writeFile(resolve(source, 'worker.mjs'), bytes);
  const linked = resolve(directory, 'linked');
  await symlink(source, linked, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(documentRuntimeFiles(linked, lockPath), /links/);
}));

test('notice enumeration includes scoped packages and skips internal module package.json metadata', () => temporary(async directory => {
  const module = await import('../../scripts/install-document-parser.mjs');
  assert.equal(typeof module.documentRuntimePackages, 'function', 'package notice enumeration is missing');
  const payloads = {
    'node_modules/@scope/example/package.json': JSON.stringify({ name: '@scope/example', version: '1.0.0', license: 'MIT' }),
    'node_modules/underscore/package.json': JSON.stringify({ name: 'underscore', version: '1.13.7', license: 'MIT' }),
    'node_modules/underscore/modules/package.json': JSON.stringify({ type: 'module' }),
  };
  const files = [];
  for (const [name, text] of Object.entries(payloads)) {
    await mkdir(resolve(directory, name, '..'), { recursive: true });
    const bytes = Buffer.from(text); await writeFile(resolve(directory, name), bytes);
    files.push({ name, bytes: bytes.length, sha256: digest(bytes) });
  }
  const lockPath = resolve(directory, 'runtime-lock.json');
  await writeFile(lockPath, JSON.stringify({ schemaVersion: 'blocky.document-runtime/v1', files }));
  const packages = await module.documentRuntimePackages(directory, lockPath);
  assert.deepEqual(packages.map(item => [item.name, item.version, item.license]), [['@scope/example', '1.0.0', 'MIT'], ['underscore', '1.13.7', 'MIT']]);
}));
