import { readFile, lstat, realpath } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const documentLicenseDirectory = resolve(root, 'vendor/licenses/document-runtime');
export async function loadDocumentLicenses(directory = documentLicenseDirectory) {
  const registry = JSON.parse(await readFile(resolve(directory, 'registry.json'), 'utf8'));
  if (registry.schemaVersion !== 'blocky.document-runtime-licenses/v1' || registry.canvasVersion !== '0.1.88' || registry.ocrVersion !== '6.1.2' || !Array.isArray(registry.licenses)) throw Error('Document license registry verification failed');
  const names = new Set();
  const entries = [];
  for (const entry of registry.licenses) {
    if (!/^[\w.-]+$/.test(entry.file) || ['.', '..'].includes(entry.file) || names.has(entry.file.toLowerCase()) || !/^[a-f0-9]{64}$/.test(entry.sha256) || !Number.isSafeInteger(entry.bytes) || entry.bytes < 1) throw Error('Document license registry verification failed');
    names.add(entry.file.toLowerCase());
    const path = resolve(directory, entry.file);
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink > 1 || await realpath(path) !== path) throw Error('Document license file verification failed');
    const bytes = await readFile(path);
    if (bytes.length !== entry.bytes || createHash('sha256').update(bytes).digest('hex') !== entry.sha256) throw Error('Document license checksum verification failed');
    entries.push({ ...entry, bytes: entry.bytes, text: bytes.toString('utf8') });
  }
  for (const name of ['Canvas', 'Skia', 'ICU', 'OCR-WASM', 'Tesseract', 'Leptonica', 'JPEG', 'GIF', 'PNG', 'TIFF', 'WebP', 'Zlib', 'OpenLibm']) if (!entries.some(entry => entry.name === name)) throw Error('Document license coverage verification failed: ' + name);
  return entries;
}
