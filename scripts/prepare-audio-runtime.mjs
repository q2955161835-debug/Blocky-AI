import { readFile, writeFile, readdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ensureAsset, verifyAsset } from './prepare-knowledge-model.mjs';
import { safeDirectory } from './build-document-parser.mjs';

export const audioRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const audioAssets = resolve(audioRoot, 'try/agent-capability-upgrade/audio-assets');
export const audioRuntimeSource = resolve(audioAssets, 'audio-runtime');
export const audioLock = JSON.parse(await readFile(resolve(audioRoot, 'vendor/audio/runtime-lock.json'), 'utf8'));
const run = promisify(execFile);

// Reuse the bounded, hash-verified atomic downloader. Retry whole downloads;
// failed partial files are removed, never promoted or treated as valid assets.
async function download(path, asset) {
  for (let attempt = 1; ; attempt++) {
    try { return await ensureAsset(path, asset); }
    catch (error) { if (attempt === 3 || /mismatch|links|exceeds/.test(error.message)) throw error; }
  }
}
export async function verifyAudioRuntime(directory) {
  directory = await safeDirectory(directory);
  const expected = audioLock.files.map(file => file.name);
  const actual = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === 'runtime-lock.json' && entry.isFile()) continue;
    if (entry.name === 'licenses' && entry.isDirectory() && !entry.isSymbolicLink()) {
      await safeDirectory(resolve(directory, 'licenses'));
      for (const name of await readdir(resolve(directory, 'licenses'))) actual.push(`licenses/${name}`);
    } else actual.push(entry.name);
  }
  if (JSON.stringify(actual.sort()) !== JSON.stringify(expected.sort())) throw Error('Audio runtime inventory mismatch');
  for (const file of audioLock.files) await verifyAsset(resolve(directory, file.name), file);
  const metadata = JSON.parse(await readFile(resolve(directory, 'runtime-lock.json'), 'utf8'));
  if (JSON.stringify(metadata) !== JSON.stringify(audioLock)) throw Error('Audio runtime manifest mismatch');
  return { directory, files: audioLock.files.length + 1, bytes: audioLock.files.reduce((n, f) => n + f.bytes, 0) };
}
export async function prepareAudioRuntime() {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw Error('Audio runtime requires Windows x64');
  await safeDirectory(audioRuntimeSource);
  await download(resolve(audioAssets, audioLock.archive.name), audioLock.archive);
  const binaries = audioLock.files.filter(file => file.archiveEntry);
  const missing = [];
  for (const file of binaries) {
    try { await verifyAsset(resolve(audioRuntimeSource, file.name), file); }
    catch (error) { if (error.code !== 'ENOENT') throw error; missing.push(file); }
  }
  if (missing.length) {
    // Only the locked CLI and DLL entries are extracted. No paths or programs
    // from the archive are executed; archive expansion is bounded separately.
    await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `
      $ErrorActionPreference='Stop'; Add-Type -AssemblyName System.IO.Compression.FileSystem;
      $zip=[IO.Compression.ZipFile]::OpenRead($env:BLOCKY_AUDIO_ARCHIVE);
      try {
        if($zip.Entries.Count -gt 64 -or ($zip.Entries | Measure-Object Length -Sum).Sum -gt 33554432){throw 'Audio archive exceeds limits'}
        foreach($file in (ConvertFrom-Json $env:BLOCKY_AUDIO_ENTRIES)) {
          $entry=$zip.GetEntry($file.archiveEntry);
          if(!$entry -or $entry.Length -ne $file.bytes){throw 'Audio archive entry mismatch'}
          [IO.Compression.ZipFileExtensions]::ExtractToFile($entry,(Join-Path $env:BLOCKY_AUDIO_OUTPUT $file.name),$false);
        }
      } finally {$zip.Dispose()}
    `], { windowsHide: true, timeout: 30_000, maxBuffer: 64 * 1024, env: { ...process.env, BLOCKY_AUDIO_ARCHIVE: resolve(audioAssets, audioLock.archive.name), BLOCKY_AUDIO_OUTPUT: audioRuntimeSource, BLOCKY_AUDIO_ENTRIES: JSON.stringify(missing) } });
  }
  for (const file of audioLock.files) {
    const output = resolve(audioRuntimeSource, file.name);
    if (file.url) await download(output, file);
    if (file.vendorFile) {
      const source = resolve(audioRoot, 'vendor/audio', file.vendorFile);
      await verifyAsset(source, file);
      await safeDirectory(dirname(output));
      try { await verifyAsset(output, file); }
      catch (error) { if (error.code !== 'ENOENT') throw error; await writeFile(output, await readFile(source), { flag: 'wx' }); }
    }
  }
  const manifest = resolve(audioRuntimeSource, 'runtime-lock.json');
  try {
    if (JSON.stringify(JSON.parse(await readFile(manifest, 'utf8'))) !== JSON.stringify(audioLock)) throw Error('Audio runtime manifest mismatch');
  } catch (error) { if (error.code !== 'ENOENT') throw error; await writeFile(manifest, JSON.stringify(audioLock, null, 2) + '\n', { flag: 'wx' }); }
  return verifyAudioRuntime(audioRuntimeSource);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) console.log(JSON.stringify(await prepareAudioRuntime()));
