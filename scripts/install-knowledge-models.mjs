import { copyFile, lstat, rename, unlink } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { root, registry, prepareModel, verifyAsset } from './prepare-knowledge-model.mjs';
import { extraKnowledgeModels, prepareExtraKnowledgeModels } from './prepare-extra-knowledge-models.mjs';
import { safeDirectory } from './build-document-parser.mjs';

async function copyLocked(source, destination, asset) {
  const info = await lstat(source);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink > 1) throw Error('Knowledge assets must be regular owned files');
  await verifyAsset(source, asset);
  await safeDirectory(dirname(destination));
  const existing = await lstat(destination).catch(error => { if (error.code !== 'ENOENT') throw error; });
  if (existing) {
    if (!existing.isFile() || existing.isSymbolicLink() || existing.nlink > 1) throw Error('Knowledge target must not contain links');
    await verifyAsset(destination, asset);
    return;
  }
  const temporary = destination + '.' + randomUUID() + '.partial';
  try {
    await copyFile(source, temporary, 1); // COPYFILE_EXCL
    await verifyAsset(temporary, asset);
    await rename(temporary, destination);
  } finally {
    await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}
export async function installModelAssets(target, models, source) {
  target = await safeDirectory(target);
  source = await safeDirectory(source);
  for (const model of models) {
    if (!/^[\w.-]+$/.test(model.directory) || ['.', '..'].includes(model.directory)) throw Error('Invalid model directory');
    await safeDirectory(join(source, model.directory));
    await safeDirectory(join(target, 'models', model.directory));
    for (const asset of model.files) {
      if (!/^[\w.-]+$/.test(asset.name) || ['.', '..'].includes(asset.name)) throw Error('Invalid model asset');
      await copyLocked(join(source, model.directory, asset.name), join(target, 'models', model.directory, asset.name), asset);
    }
  }
}
export async function installKnowledgeModels(target) {
  if (!target) throw Error('Knowledge install requires a project target');
  target = await safeDirectory(target);
  await prepareModel();
  await prepareExtraKnowledgeModels();
  await installModelAssets(target, [registry.model], join(root, 'try/stage3/models'));
  await installModelAssets(target, extraKnowledgeModels.models, join(root, 'try/agent-capability-upgrade/knowledge-models'));
  // E5 licenses also cover the ONNX/DirectML runtime. Preserve the immutable
  // originals next to independent CLI and development installations.
  for (const license of [...registry.licenses, ...extraKnowledgeModels.licenses]) {
    const source = join(root, 'vendor/models', license.file);
    const info = await lstat(source);
    await copyLocked(source, join(target, 'licenses', license.file.split('/').at(-1)), { ...license, bytes: license.bytes ?? info.size });
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await installKnowledgeModels(process.argv[2]);
  console.log('Locked E5, MiniLM and reranking models installed.');
}
