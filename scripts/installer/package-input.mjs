import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile, realpath, readdir } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { peImports } from "./pe-imports.mjs";

export const sha256 = async path => {
  const hash = createHash("sha256");
  for await (const bytes of createReadStream(path)) hash.update(bytes);
  return hash.digest("hex");
};
export function manifestPath(path) {
  if (typeof path !== "string" || !path || isAbsolute(path) || /[\\<>:"|?*\x00-\x1f]/.test(path) || path.split("/").some(part => !part || part === "." || part === ".." || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) throw Error("Unsafe installer manifest path");
  return path;
}
export async function unlinked(path) {
  for (let current = resolve(path); ; current = dirname(current)) {
    const stat = await lstat(current);
    if (stat.isSymbolicLink()) throw Error("Installer paths must not contain links");
    if (dirname(current) === current) break;
  }
  if ((await realpath(path)).toLowerCase() !== resolve(path).toLowerCase()) throw Error("Installer paths must resolve literally");
}
export async function verifyPackage(directory, manifestFile, workspace) {
  directory = resolve(directory);
  await unlinked(directory);
  await unlinked(manifestFile);
  const manifestBytes = await readFile(manifestFile);
  const manifest = JSON.parse(manifestBytes.toString("utf8").replace(/^\uFEFF/, ""));
  if (!Array.isArray(manifest.files) || !manifest.files.length || manifest.files.length > 100000 || resolve(workspace, manifest.directory).toLowerCase() !== directory.toLowerCase()) throw Error("Installer package/manifest identity mismatch");
  const files = [], paths = new Set(), dependencies = [];
  for (const entry of manifest.files) {
    const path = manifestPath(entry.path);
    if (paths.has(path.toLowerCase()) || !Number.isSafeInteger(entry.bytes) || entry.bytes < 0 || !/^[a-f0-9]{64}$/.test(entry.sha256)) throw Error("Invalid or duplicate installer manifest entry");
    paths.add(path.toLowerCase());
    const absolute = join(directory, path);
    await unlinked(absolute);
    const stat = await lstat(absolute);
    if (!stat.isFile() || stat.nlink !== 1 || stat.size !== entry.bytes || await sha256(absolute) !== entry.sha256) throw Error(`Installer package mismatch: ${path}`);
    files.push({...entry, absolute});
    if (/\.(exe|dll)$/i.test(path)) dependencies.push({path, imports: peImports(await readFile(absolute))});
  }
  const actual = [];
  async function walk(folder) {
    for (const entry of await readdir(folder, {withFileTypes: true})) {
      const path = join(folder, entry.name);
      if (entry.isSymbolicLink()) throw Error("Installer package contains links");
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) actual.push(relative(directory, path).replaceAll("\\", "/"));
      else throw Error("Unsupported installer file type");
    }
  }
  await walk(directory);
  if (actual.length !== files.length || actual.some(path => !paths.has(path.toLowerCase()))) throw Error("Unlisted installer package files");
  if (!paths.has("blocky studio.exe") || paths.has("uninstall.exe") || paths.has("installer-manifest.json")) throw Error("Missing entry point or reserved installer file");
  const vc = /^((msvcp|vcruntime|concrt)140[^/]*\.dll)$/i;
  const vcExternal = new Set();
  for (const image of dependencies) for (const imported of image.imports) {
    const local = join(dirname(image.path), imported).replaceAll("\\", "/").toLowerCase();
    if (vc.test(imported) && !paths.has(local) && !paths.has(imported)) vcExternal.add(imported);
  }
  return {directory, manifest, manifestSha256: createHash("sha256").update(manifestBytes).digest("hex"), files, dependencies, vcExternal: [...vcExternal].sort()};
}
