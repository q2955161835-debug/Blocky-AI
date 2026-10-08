import { execFileSync } from "node:child_process";
import { access, mkdir, readFile, writeFile, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { sha256, unlinked, verifyPackage } from "./installer/package-input.mjs";

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const publicVcUrl = "https://aka.ms/vs/17/release/vc_redist.x64.exe";
export const quoteNsis = text => `"${String(text).replaceAll("$", () => "$$").replaceAll('"', '$\\"')}"`;
function inside(parent, path) { const rel = relative(parent, path); return rel && !rel.startsWith("..") && !isAbsolute(rel); }
async function toolPath(explicit) {
  const candidates = [explicit, process.env.MAKENSIS, process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, "tauri/NSIS/makensis.exe"), process.env["ProgramFiles(x86)"] && join(process.env["ProgramFiles(x86)"], "NSIS/makensis.exe")].filter(Boolean);
  for (const candidate of candidates) { try { await access(candidate); return resolve(candidate); } catch {} }
  throw Error("Existing NSIS makensis.exe is required; this script never downloads tools");
}
function options(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    if (!["--package", "--manifest", "--output", "--display-name", "--release-version", "--makensis"].includes(key) || Object.hasOwn(values, key) || !argv[index + 1]) throw Error("Usage: node scripts/build-installer.mjs --package DIR --manifest FILE --output FILE.exe --display-name 'Blocky Studio（测试版） VERSION' [--release-version 0.8.0-beta.1] [--makensis EXE]");
    values[key] = argv[index + 1];
  }
  for (const key of ["--package", "--manifest", "--output", "--display-name"]) if (!values[key]) throw Error(`Required installer option: ${key}`);
  return values;
}
export async function buildInstaller(argv) {
  if (process.platform !== "win32") throw Error("Build this Windows installer on Windows");
  const args = options(argv), output = resolve(args["--output"]), displayName = args["--display-name"];
  if (!displayName.includes("测试版") || displayName.length > 128 || /[\x00-\x1f]/.test(displayName)) throw Error("Installer display name must explicitly identify the test version");
  if (!/\.exe$/i.test(output) || ![join(workspace, "dist"), join(workspace, "try")].some(parent => inside(parent, output))) throw Error("Installer output must be a new .exe under workspace dist or try");
  try { await access(output); throw Error("Installer output already exists; never overwrite a frozen installer"); } catch (error) { if (error.code !== "ENOENT") throw error; }
  await mkdir(dirname(output), {recursive: true});
  await unlinked(dirname(output));
  const packageData = await verifyPackage(resolve(args["--package"]), resolve(args["--manifest"]), workspace);
  const version = JSON.parse(await readFile(join(workspace, "package.json"), "utf8")).version;
  if (!/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(version)) throw Error("Unsupported installer product version");
  const releaseVersion = args["--release-version"] ?? version;
  if (!/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(releaseVersion) || releaseVersion.split("-")[0] !== version.split("-")[0]) throw Error("Installer release version must match the product version");
  const fileVersion = `${version.split("-")[0]}.0`;
  const work = join(workspace, "try", "installer-2026-10-09", `build-${Date.now()}`);
  await mkdir(work, {recursive: true});
  await unlinked(work);
  const installerManifest = join(work, "installer-manifest.json");
  await writeFile(installerManifest, JSON.stringify({schemaVersion: "blocky.installer-package/v1", displayName, version, releaseVersion, sourceCommit: packageData.manifest.sourceCommit, sourceManifestSha256: packageData.manifestSha256, files: packageData.files.map(({path, bytes, sha256}) => ({path, bytes, sha256}))}, null, 2));
  const directories = new Set();
  const install = [], uninstall = [];
  for (const file of packageData.files) {
    const local = file.path.replaceAll("/", "\\"), folder = dirname(file.path).replaceAll("/", "\\");
    install.push(`SetOutPath ${quoteNsis(folder === "." ? "$INSTDIR" : `$INSTDIR\\${folder}`).replace('"$$INSTDIR', '"$INSTDIR')}`);
    install.push(`File ${quoteNsis(`/oname=${file.path.split("/").at(-1)}`)} ${quoteNsis(file.absolute)}`);
    uninstall.push(`Delete ${quoteNsis(`$INSTDIR\\${local}`).replace('"$$INSTDIR', '"$INSTDIR')}`);
    let parent = dirname(file.path);
    while (parent !== ".") { directories.add(parent); parent = dirname(parent); }
  }
  const dirRemoval = [...directories].sort((a, b) => b.split("/").length - a.split("/").length).map(path => `RMDir ${quoteNsis(`$INSTDIR\\${path.replaceAll("/", "\\")}`).replace('"$$INSTDIR', '"$INSTDIR')}`);
  const vcCheck = packageData.vcExternal.flatMap((dll, index) => [`IfFileExists "$WINDIR\\Sysnative\\${dll}" vc_present_${index} vc_missing`, `vc_present_${index}:`]);
  if (packageData.vcExternal.length) vcCheck.push(
    'ReadRegDWORD $0 HKLM "SOFTWARE\\Microsoft\\VisualStudio\\14.0\\VC\\Runtimes\\x64" "Installed"',
    'ReadRegDWORD $1 HKLM "SOFTWARE\\Microsoft\\VisualStudio\\14.0\\VC\\Runtimes\\x64" "Major"',
    'ReadRegDWORD $2 HKLM "SOFTWARE\\Microsoft\\VisualStudio\\14.0\\VC\\Runtimes\\x64" "Minor"',
    '${If} $0 != 1', 'Goto vc_missing', '${EndIf}', '${If} $1 < 14', 'Goto vc_missing', '${EndIf}', '${If} $1 == 14', '${AndIf} $2 < 44', 'Goto vc_missing', '${EndIf}',
    'Goto vc_ready', 'vc_missing:',
    `MessageBox MB_OK|MB_ICONSTOP "缺少兼容的 Microsoft Visual C++ x64 运行库（14.44或更新）。本包PE导入要求：${packageData.vcExternal.join(", ")}。请从 ${publicVcUrl} 下载并运行官方x64安装器后重试；本安装器不会下载或静默安装依赖。" /SD IDOK`,
    'SetErrorLevel 6', 'Quit', 'vc_ready:',
  );
  const settings = [
    `!define BETA_DISPLAY_NAME ${quoteNsis(displayName)}`,
    `!define INSTALLER_OUTPUT ${quoteNsis(output)}`,
    `!define BETA_ICON ${quoteNsis(join(workspace, "apps/studio-host/icons/icon.ico"))}`,
    `!define APP_VERSION ${quoteNsis(version)}`, `!define RELEASE_VERSION ${quoteNsis(releaseVersion)}`, `!define FILE_VERSION ${quoteNsis(fileVersion)}`,
    '!define BETA_UNINSTALL_KEY "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\BlockyStudioBeta"',
    `!define INSTALLED_KIB ${Math.ceil(packageData.files.reduce((sum, file) => sum + file.bytes, 0) / 1024)}`,
    `!define INSTALLER_MANIFEST ${quoteNsis(installerManifest)}`,
    '!macro CHECK_VC_DEPENDENCIES', ...vcCheck, '!macroend',
    '!macro INSTALL_PACKAGE_FILES', ...install, '!macroend',
    '!macro UNINSTALL_PACKAGE_FILES', ...uninstall, '!macroend',
    '!macro REMOVE_EMPTY_PACKAGE_DIRECTORIES', ...dirRemoval, '!macroend',
  ].join("\r\n");
  await writeFile(join(work, "build-settings.nsh"), settings);
  const makensis = await toolPath(args["--makensis"]);
  const compilerVersion = execFileSync(makensis, ["-VERSION"], {windowsHide: true, encoding: "utf8"}).trim();
  const template = join(workspace, "scripts/installer/beta.nsi");
  let compilerLog;
  try {
    compilerLog = execFileSync(makensis, ["/V3", "/INPUTCHARSET", "UTF8", `/X!addincludedir ${quoteNsis(work)}`, template], {windowsHide: true, encoding: "utf8", maxBuffer: 16 * 1024 * 1024, env: {...process.env, TEMP: work, TMP: work}});
  } catch (error) {
    await writeFile(join(work, "compile.log"), String(error.stdout ?? "") + String(error.stderr ?? ""));
    throw Error(`NSIS compiler failed; inspect ${join(work, "compile.log")}`);
  }
  await writeFile(join(work, "compile.log"), compilerLog);
  // The payload is pinned before and after compilation; any concurrent package edit invalidates it.
  await verifyPackage(packageData.directory, resolve(args["--manifest"]), workspace);
  const installerBytes = await readFile(output);
  for (const prefix of [workspace, workspace.replaceAll("\\", "/"), homedir(), homedir().replaceAll("\\", "/")]) {
    if (installerBytes.includes(Buffer.from(prefix)) || installerBytes.includes(Buffer.from(prefix, "utf16le"))) throw Error("A local development path appears in the compiled installer");
  }
  const receipt = {schemaVersion: "blocky.installer-build/v1", displayName, version, releaseVersion, installer: relative(workspace, output).replaceAll("\\", "/"), bytes: (await stat(output)).size, sha256: await sha256(output), packageDirectory: relative(workspace, packageData.directory).replaceAll("\\", "/"), packageFiles: packageData.files.length, packageBytes: packageData.files.reduce((sum, file) => sum + file.bytes, 0), sourceCommit: packageData.manifest.sourceCommit, sourceManifestSha256: packageData.manifestSha256, makensis, compilerVersion, dependencies: packageData.dependencies, vcExternal: packageData.vcExternal, checks: {fileHashesBeforeAndAfter: true, exactManifestCoverage: true, noLinksOrPathEscape: true, noRawLocalPathsInInstaller: true, compiledOnly: true, installationExecuted: false, uninstallationExecuted: false}, workDirectory: relative(workspace, work).replaceAll("\\", "/")};
  await writeFile(`${output}.build.json`, JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify(receipt, null, 2));
  return receipt;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await buildInstaller(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
