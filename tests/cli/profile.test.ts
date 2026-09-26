import { expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
const cli = resolve("tools/blocky-cli/dist/main.mjs");
function run(args: string[], env: NodeJS.ProcessEnv) {
  const child = spawnSync(process.execPath, [cli, ...args], { env, encoding:"utf8", windowsHide:true, timeout:20000 });
  return { code:child.status, result:JSON.parse(child.stdout.trim().split(/\r?\n/).at(-1)!) };
}
it("isolates settings, secrets and RPA records across explicit native profiles",async()=>{
  const dir=await mkdtemp(resolve("try/profile-cli-"));
  try {
    const defaultRoot=join(dir,"default"),a=join(dir,"a"),b=join(dir,"b");
    await mkdir(defaultRoot); await writeFile(join(defaultRoot,"sentinel.txt"),"default profile unchanged");
    const envA={...process.env,LOCALAPPDATA:defaultRoot,BLOCKY_PROFILE_DIR:a};
    const envB={...envA,BLOCKY_PROFILE_DIR:b};
    const result=run(["profile","show","--json"],envA);
    expect(result.code).toBe(0); expect(result.result.data.profile).toEqual({profileId:createHash("sha256").update(a.toLowerCase()).digest("hex"),custom:true});
    expect(JSON.stringify(result.result)).not.toContain(a);
    expect(run(["profile","show","--json"],envB).result.data.profile.profileId).not.toBe(result.result.data.profile.profileId);
    expect(run(["settings","set","--id","ui.reduceMotion","--value","true","--json"],envA).code).toBe(0);
    expect(run(["settings","list","--json"],envA).result.data.settings.values["ui.reduceMotion"]).toBe(true);
    expect(run(["settings","list","--json"],envB).result.data.settings.values["ui.reduceMotion"]).not.toBe(true);
    const secret=join(dir,"owned.env"); await writeFile(secret,"OWNED_PROFILE_TEST=synthetic-profile-canary\n");
    expect(run(["secret","import","--id","owned-key","--env-file",secret,"--variable","OWNED_PROFILE_TEST","--json"],envA).code).toBe(0);
    expect(run(["secret","status","--id","owned-key","--json"],envA).result.data.configured).toBe(true);
    expect(run(["secret","status","--id","owned-key","--json"],envB).result.data.configured).toBe(false);
    expect(run(["rpa","checkpoints","--json"],envA).result.data.checkpoints).toEqual([]);
    expect(await readFile(join(a,"user/settings/app.json"),"utf8")).toContain("ui.reduceMotion");
    await expect(readFile(join(defaultRoot,"ai.blocky.studio/user/settings/app.json"))).rejects.toThrow();
    expect(await readFile(join(defaultRoot,"sentinel.txt"),"utf8")).toBe("default profile unchanged");
    const denied=run(["settings","list","--json"],{...envA,BLOCKY_PROFILE_DIR:"relative-path"});
    expect(denied.code).not.toBe(0);expect(denied.result.error.code).toBe("BLK-PROFILE-001");
  } finally { await rm(dir,{recursive:true,force:true}); }
});
