import {test} from "node:test";
import assert from "node:assert/strict";
import {execFileSync, spawnSync} from "node:child_process";
import {mkdir, mkdtemp, readFile, writeFile, readdir} from "node:fs/promises";
import {join, resolve, relative} from "node:path";
import {fileURLToPath} from "node:url";
import {quoteNsis} from "../build-installer.mjs";

const workspace = fileURLToPath(new URL("../..", import.meta.url));
const executable = process.env.MAKENSIS ?? join(process.env.LOCALAPPDATA ?? "", "tauri/NSIS/makensis.exe");
const base = resolve("try/installer-2026-10-09");

test("real NSIS rejects a nonempty target and extraction denied by Windows ACL before registration", {skip: process.platform !== "win32"}, async () => {
  await mkdir(base, {recursive:true});
  const root = await mkdtemp(join(base,"io-boundary-"));
  assert.ok(!relative(base,root).startsWith(".."));
  const temporary = join(root,"temp"); await mkdir(temporary);
  const env = {...process.env,TEMP:temporary,TMP:temporary};
  const payload = join(root,"payload.txt"); await writeFile(payload,"verified miniature payload\n");
  const source = join(root,"boundary.nsi"), installer = join(root,"filesystem-only-boundary.exe");
  const sourceText = `Unicode true
RequestExecutionLevel user
SilentInstall silent
Name "Filesystem-only installer boundary test"
OutFile ${quoteNsis(installer)}
Var PayloadStarted
!macro CLEANUP_FAILED_INSTALL
  StrCmp $PayloadStarted 1 0 +2
  Delete "$INSTDIR\\payload.txt"
!macroend
!include ${quoteNsis(join(workspace,"scripts/installer/install-safety.nsh"))}
Section
  Call CheckInstallDirectory
  StrCpy $PayloadStarted 1
  SetOverwrite off
  ClearErrors
  SetOutPath "$INSTDIR"
  !insertmacro CHECK_INSTALL_WRITE
  ClearErrors
  File /oname=payload.txt ${quoteNsis(payload)}
  !insertmacro CHECK_INSTALL_WRITE
  ; A marker proves whether execution reached registration; this test has no registry/shortcut commands.
  FileOpen $2 "$INSTDIR\\registration-reached.txt" w
  FileWrite $2 "reached"
  FileClose $2
SectionEnd
`;
  assert.ok(!/WriteReg|CreateShortcut/i.test(sourceText));
  await writeFile(source,sourceText);
  const compileLog = execFileSync(executable,["/V3","/INPUTCHARSET","UTF8",source],{windowsHide:true,encoding:"utf8",env});
  await writeFile(join(root,"compile.log"),compileLog);
  const run = target => {
    const result = spawnSync(installer,["/S",`/D=${target}`],{windowsHide:true,encoding:"utf8",env,timeout:30000});
    assert.ifError(result.error);
    return result.status;
  };
  const populated = join(root,"populated"); await mkdir(populated);
  await writeFile(join(populated,"user-file.txt"),"must remain exactly unchanged\n");
  const before = await readFile(join(populated,"user-file.txt"));
  const nonemptyExit = run(populated);
  assert.notEqual(nonemptyExit,0);
  assert.deepEqual(await readdir(populated),["user-file.txt"]);
  assert.deepEqual(await readFile(join(populated,"user-file.txt")),before);

  const denied = join(root,"denied"); await mkdir(denied);
  let deniedExit;
  try {
    execFileSync("icacls.exe",[denied,"/deny","*S-1-1-0:(OI)(CI)(W)"],{windowsHide:true,env});
    deniedExit = run(denied);
    assert.notEqual(deniedExit,0);
  } finally {
    execFileSync("icacls.exe",[denied,"/remove:d","*S-1-1-0"],{windowsHide:true,env});
  }
  assert.deepEqual(await readdir(denied),[]);
  const positive = join(root,"positive"); await mkdir(positive);
  const positiveExit = run(positive);
  assert.equal(positiveExit,0);
  assert.equal(await readFile(join(positive,"payload.txt"),"utf8"),"verified miniature payload\n");
  assert.equal(await readFile(join(positive,"registration-reached.txt"),"utf8"),"reached");
  await writeFile(join(root,"results.json"),JSON.stringify({nonemptyExit,deniedExit,positiveExit,nonemptyUnchanged:true,deniedNoRegistration:true,noRegistryOrShortcuts:true,temporaryDirectory:temporary},null,2));
});
