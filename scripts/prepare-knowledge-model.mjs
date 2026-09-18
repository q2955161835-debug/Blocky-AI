import { createReadStream } from "node:fs";
import { mkdir, stat, open, rename, unlink, readFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const registry = JSON.parse(await readFile(resolve(root, "vendor/models/registry.json"), "utf8"));
export async function verifyAsset(path, asset) {
  const info = await stat(path);
  if (!info.isFile() || info.size !== asset.bytes) throw Error(`Asset size mismatch: ${asset.name ?? "archive"}`);
  const hash = createHash("sha256");
  for await (const bytes of createReadStream(path)) hash.update(bytes);
  if (hash.digest("hex") !== asset.sha256) throw Error(`Asset checksum mismatch: ${asset.name ?? "archive"}`);
}
export async function ensureAsset(path, asset, downloader = fetch) {
  try { await verifyAsset(path, asset); return "verified"; }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.partial`;
  let file;
  try {
    const response = await downloader(asset.url, { signal: AbortSignal.timeout(600_000) });
    if (!response.ok || !response.body) throw Error(`Asset download failed: ${response.status}`);
    file = await open(temporary, "wx");
    let total = 0;
    const hash = createHash("sha256");
    for await (const chunk of response.body) {
      total += chunk.length;
      if (total > asset.bytes) throw Error("Asset download exceeds locked size");
      hash.update(chunk);
      await file.writeFile(chunk);
    }
    if (total !== asset.bytes || hash.digest("hex") !== asset.sha256) throw Error("Asset download checksum mismatch");
    await file.sync(); await file.close(); file = undefined;
    await rename(temporary, path);
    return "downloaded";
  } finally {
    await file?.close();
    await unlink(temporary).catch(error => { if (error.code !== "ENOENT") throw error; });
  }
}
export async function prepareModel(directory = resolve(root, "try/stage3/models", registry.model.directory)) {
  const results = [];
  for (const asset of registry.model.files) results.push({ name: asset.name, status: await ensureAsset(resolve(directory, asset.name), asset) });
  return results;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify({ modelId: registry.model.id, files: await prepareModel(process.argv[2] && resolve(process.argv[2])) }));
}
