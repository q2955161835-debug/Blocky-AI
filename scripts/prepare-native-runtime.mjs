import { copyFile, mkdir, access, rename, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { root, registry, verifyAsset, ensureAsset } from "./prepare-knowledge-model.mjs";

export const runtimeDirectory = resolve(root, "try/stage3/runtime");
export async function prepareDirectML() {
  const asset = registry.directml;
  const destination = join(runtimeDirectory, asset.name);
  try { await verifyAsset(destination, asset); return destination; }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  await mkdir(runtimeDirectory, { recursive: true });
  const temporary = `${destination}.${randomUUID()}.partial`;
  try {
    // ort-sys already verifies its archive. Recheck the DLL independently.
    const cache = process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, "ort.pyke.io/dfbin/x86_64-pc-windows-msvc", asset.ortCacheKey, asset.name);
    let cached = false;
    if (cache) { try { await verifyAsset(cache, asset); cached = true; } catch (error) { if (error.code !== "ENOENT") throw error; } }
    if (cached) await copyFile(cache, temporary);
    else {
      const archive = join(runtimeDirectory, "microsoft.ai.directml.1.15.4.nupkg");
      await ensureAsset(archive, asset.archive);
      execFileSync("powershell.exe", ["-NoProfile", "-File", join(root, "scripts/extract-directml.ps1"), "-Archive", archive, "-Destination", temporary], { windowsHide: true, stdio: "pipe" });
    }
    await verifyAsset(temporary, asset);
    await rename(temporary, destination);
    return destination;
  } finally { await unlink(temporary).catch(error => { if (error.code !== "ENOENT") throw error; }); }
}
export async function installDirectML(directory) {
  await mkdir(directory, { recursive: true });
  const destination = join(directory, registry.directml.name);
  await copyFile(await prepareDirectML(), destination);
  await verifyAsset(destination, registry.directml);
}
export async function checkSystemRuntime() {
  if (process.platform !== "win32") throw Error("Windows x64 runtime check requires Windows");
  const system = join(process.env.SystemRoot ?? "C:\\Windows", "System32");
  for (const name of registry.vcRuntime.files) await access(join(system, name)).catch(() => { throw Error(`Install the official Microsoft Visual C++ x64 runtime: missing ${name}`); });
  const version = JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-Command", "$v=(Get-Item -LiteralPath ($env:SystemRoot + '/System32/msvcp140.dll')).VersionInfo; @{major=$v.FileMajorPart;minor=$v.FileMinorPart;build=$v.FileBuildPart} | ConvertTo-Json -Compress"], { windowsHide: true, encoding: "utf8" }));
  if (version.major !== 14 || version.minor < 44) throw Error("Microsoft Visual C++ x64 runtime 14.44 or newer is required");
  return { status: "available", version: `${version.major}.${version.minor}.${version.build}`, redistribution: "system prerequisite; not bundled", files: registry.vcRuntime.files };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await prepareDirectML();
  console.log(JSON.stringify({ directml: registry.directml.version, vcRuntime: await checkSystemRuntime() }));
}
