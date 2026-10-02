import { expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parse } from "../../tools/blocky-cli/src/arguments";
import { createArchitectureStarter } from "../../packages/block-catalog/src";
import { createProject, readProject } from "../../tools/blocky-cli/src/native-store";
import { RecordingBuffer } from "../../packages/rpa-core/src/recording";

const cli = resolve("tools/blocky-cli/dist/main.mjs");
it.each(["browser", "windows"])("reports %s coordinate risk and applies the same explicit coordinate permission to ordinary blocks", async (kind) => {
  const dir = await mkdtemp(resolve("try/stage7-coordinate-cli-"));
  try {
    const project = createArchitectureStarter("rule-engine"), path = join(dir, "original.blocky"), planPath = join(dir, "plan.json"), patchPath = join(dir, "patch.json"), output = join(dir, "coordinate.blocky");
    const plan = { schemaVersion: "blocky.rpa/v1", planId: "coordinate", target: { kind, identity: kind === "browser" ? "https://example.test" : "windows:fixture" }, steps: [{ stepId: "click", action: "click", locator: { kind: "coordinate", x: kind === "browser" ? 50 : -50, y: 60, riskAccepted: true }, effectKey: "once" }] };
    await createProject(path, project); await writeFile(planPath, JSON.stringify(plan));
    const env = { ...process.env, BLOCKY_PROFILE_DIR: join(dir, "profile") };
    const validated = run(["rpa", "validate", planPath, "--json"], env);
    expect(validated.code).toBe(0); expect(validated.result.data.coordinateSpace).toBe(kind === "browser" ? "browser-viewport-css-pixels" : "screen-physical-pixels");
    expect(validated.result.data.warnings.some((warning: {code:string}) => warning.code === "BLK-RPA-UNSUPPORTED-001")).toBe(false);
    expect(validated.result.data.warnings[0].code).toBe("BLK-RPA-COORDINATE-RISK");
    expect(JSON.stringify(run(["schema", "show", "blocky.rpa/v1", "--json"], env).result)).toContain("CSS");
    expect(run(["rpa", "draft", path, "--plan", planPath, "--module", "main", ...(kind === "browser" ? ["--browser-url", "https://example.test/"] : []), "--output", patchPath, "--json"], env).code).toBe(0);
    const patch = JSON.parse(await readFile(patchPath, "utf8")); expect(patch.permissionDelta).toContain("rpa.coordinate");
    expect(run(["patch", "apply", path, "--patch", patchPath, "--approve-permissions", patch.permissionDelta.filter((p: string) => p !== "rpa.coordinate").join(","), "--output", output, "--json"], env).result.error.code).toBe("BLK-PATCH-003");
    expect(run(["patch", "apply", path, "--patch", patchPath, "--approve-permissions", patch.permissionDelta.join(","), "--output", output, "--json"], env).code).toBe(0);
    expect(JSON.stringify(await readProject(output))).toContain('"riskAccepted":true');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
it("exposes sensitive purpose in schema and preserves it through the same native patch guard", async () => {
  const dir = await mkdtemp(resolve("try/stage7-sensitive-cli-"));
  try {
    const project = createArchitectureStarter("rule-engine"), path = join(dir, "original.blocky"), plan = join(dir, "plan.json"), patch = join(dir, "patch.json"), output = join(dir, "sensitive.blocky");
    await createProject(path, project);
    await writeFile(plan, JSON.stringify({ schemaVersion: "blocky.rpa/v1", planId: "sensitive", target: { kind: "browser", identity: "https://example.test" }, steps: [{ stepId: "fill", action: "fill", locator: { kind: "browser", role: "textbox", name: "Password" }, value: { kind: "manual-input", sensitive: true }, effectKey: "once" }] }));
    const env = { ...process.env, BLOCKY_PROFILE_DIR: join(dir, "profile") };
    const schema = run(["schema", "show", "blocky.rpa/v1", "--json"], env);
    expect(schema.code).toBe(0); expect(JSON.stringify(schema.result)).toContain("sensitive");
    const drafted = run(["rpa", "draft", path, "--plan", plan, "--module", "main", "--browser-url", "https://example.test/form", "--output", patch, "--json"], env);
    expect(drafted.code, JSON.stringify(drafted.result)).toBe(0);
    const candidate = JSON.parse(await readFile(patch, "utf8"));
    expect(candidate.permissionDelta).toContain("rpa.sensitive-input");
    const applied = run(["patch", "apply", path, "--patch", patch, "--approve-permissions", candidate.permissionDelta.join(","), "--output", output, "--json"], env);
    expect(applied.code, JSON.stringify(applied.result)).toBe(0);
    expect(JSON.stringify(await readProject(output))).toContain('"INPUT_KIND":"sensitive"');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
it("discovers recording controls and converts captured metadata to a reviewed patch for its own project only", async () => {
  const dir = await mkdtemp(resolve("try/stage7-recording-cli-"));
  try {
    const project = createArchitectureStarter("rule-engine"), path = join(dir, "original.blocky"), requestPath = join(dir, "request.json"), recordingPath = join(dir, "recording.json"), patchPath = join(dir, "patch.json");
    await createProject(path, project);
    const original = await readFile(path);
    const request = { schemaVersion: "blocky.rpa-recording-start/v1", projectId: project.manifest.projectId, sessionId: "recording-owned", target: { kind: "browser", identity: "https://example.test" }, url: "https://example.test/form" };
    const capture = new RecordingBuffer({ projectId: request.projectId, sessionId: request.sessionId, target: { kind: "browser", identity: "browser:11111111-1111-4111-8111-111111111111" } });
    capture.append({ action: "fill", locator: { kind: "browser", role: "textbox", name: "Question" } });
    await writeFile(requestPath, JSON.stringify(request)); await writeFile(recordingPath, JSON.stringify(capture.seal("stopped")));
    const env = { ...process.env, BLOCKY_PROFILE_DIR: join(dir, "profile") };
    const result = run(["rpa", "recording-draft", path, "--recording", recordingPath, "--request", requestPath, "--module", "main", "--output", patchPath, "--json"], env);
    expect(result.code, JSON.stringify(result.result)).toBe(0);
    expect(result.result.data.requiresReview).toBe(true); expect(result.result.data.modelApiCalled).toBe(false);
    expect(await readFile(path)).toEqual(original);
    const patch = JSON.parse(await readFile(patchPath, "utf8"));
    expect(patch.permissionDelta).toContain("rpa.input");
    expect(JSON.stringify(patch)).not.toContain("browser:11111111");
    expect(JSON.stringify(patch)).toContain("https://example.test/form");
    await writeFile(requestPath, JSON.stringify({ ...request, projectId: "another-project" }));
    const rejected = run(["rpa", "recording-draft", path, "--recording", recordingPath, "--request", requestPath, "--module", "main", "--output", join(dir, "foreign.json"), "--json"], env);
    expect(rejected.result.error.code).toBe("BLK-RPA-TARGET-001");
    expect(run(["command", "list", "--query", "rpa record", "--json"], env).result.data.commands).toHaveLength(3);
    for (const schema of ["start", "result", "stop"]) expect(run(["schema", "show", `blocky.rpa-recording-${schema}/v1`, "--json"], env).code).toBe(0);
    expect(run(["rpa", "record", requestPath, "--output", join(dir, "unused.json"), "--jsonl"], env).result.error.code).toBe("BLK-CLI-002");
  } finally { await rm(dir, { recursive: true, force: true }); }
});
it("settles a real private recording Host without opening a prompt when its target is unavailable", async () => {
  const dir = await mkdtemp(resolve("try/stage7-recording-native-"));
  try {
    const requestPath = join(dir, "request.json");
    await writeFile(requestPath, JSON.stringify({ schemaVersion: "blocky.rpa-recording-start/v1", sessionId: "recording-unavailable", projectId: "project-one", target: { kind: "windows", identity: `unavailable-${crypto.randomUUID()}` } }));
    const child = spawnSync(process.execPath, [cli, "rpa", "record", requestPath, "--control-stdin", "--output", join(dir, "recording.json"), "--jsonl"], { input: "", encoding: "utf8", timeout: 15000, windowsHide: true, env: { ...process.env, BLOCKY_PROFILE_DIR: join(dir, "profile") } });
    expect(child.error).toBeUndefined(); expect(child.status).toBe(7);
    const messages = child.stdout.trim().split(/\r?\n/).map(line => JSON.parse(line));
    expect(messages.some(message => message.type === "settled" && message.value.settled === true)).toBe(true);
    expect(messages.at(-1).error.code).toBe("BLK-RPA-TARGET-001");
    await expect(readFile(join(dir, "recording.json"))).rejects.toMatchObject({ code: "ENOENT" });
  } finally { await rm(dir, { recursive: true, force: true }); }
});
it("creates a reviewable RPA module patch, enforces native permission approval and keeps simulate inert",async()=>{
  const dir=await mkdtemp(resolve("try/stage7-rpa-module-"));
  try{
    const env={...process.env,LOCALAPPDATA:dir,BLOCKY_PROFILE_DIR:join(dir,"ai.blocky.studio")},projectPath=join(dir,"original.blocky"),planPath=join(dir,"plan.json"),patchPath=join(dir,"patch.json"),output=join(dir,"changed.blocky");
    await createProject(projectPath,createArchitectureStarter("rule-engine"));
    await writeFile(planPath,JSON.stringify({schemaVersion:"blocky.rpa/v1",planId:"owned",target:{kind:"browser",identity:"https://example.test"},steps:[{stepId:"read",action:"read",timeoutMs:1000,locator:{kind:"browser",role:"status",name:"Saved"}}]}));
    const original=await readFile(projectPath);
    const draft=run(["rpa","draft",projectPath,"--plan",planPath,"--module","main","--browser-url","https://example.test/form","--output",patchPath,"--json"],env);
    expect(draft.code).toBe(0);expect(draft.result.data.requiresReview).toBe(true);
    expect(await readFile(projectPath)).toEqual(original);
    const patch=JSON.parse(await readFile(patchPath,"utf8"));
    expect(patch.permissionDelta).toEqual(["rpa.browser","rpa.read"]);
    const denied=run(["patch","apply",projectPath,"--patch",patchPath,"--output",output,"--json"],env);
    expect(denied.result.error.code).toBe("BLK-PATCH-003");
    const applied=run(["patch","apply",projectPath,"--patch",patchPath,"--approve-permissions",patch.permissionDelta.join(","),"--output",output,"--json"],env);
    expect(applied.code,JSON.stringify(applied.result)).toBe(0);
    const simulated=run(["run","start",output,"--simulate","--input","ignored","--entry",patch.operations[0].blockId,"--module","main","--jsonl"],env);
    expect(simulated.code).toBe(3);expect(simulated.result.data.status).toBe("failed");expect(simulated.result.data.modelApiCalled).toBe(false);
    expect(run(["schema","show","blocky.rpa-module-inputs/v1","--json"],env).code).toBe(0);
  }finally{await rm(dir,{recursive:true,force:true});}
});
function run(args: string[], env = process.env) {
  const child = spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", timeout: 30000, windowsHide: true, env });
  return { code: child.status, result: JSON.parse(child.stdout.trim().split(/\r?\n/).at(-1) ?? "{}") };
}
it("discovers persisted receipt queries and refuses invalid checkpoint identities", async () => {
  const dir = await mkdtemp(resolve("try/stage7-rpa-query-"));
  try {
    const env = { ...process.env, LOCALAPPDATA: dir, BLOCKY_PROFILE_DIR: join(dir, "ai.blocky.studio") };
    const list = run(["rpa", "checkpoints", "--json"], env);
    expect(list.code).toBe(0);
    expect(list.result.data.checkpoints).toEqual([]);
    expect(list.result.data.modelApiCalled).toBe(false);
    const invalid = run(["rpa", "checkpoint", "checkpoint-../other", "--json"], env);
    expect(invalid.code).not.toBe(0);
    expect(invalid.result.error.code).toBe("BLK-RPA-JOURNAL-002");
    const commands = run(["command", "list", "--query", "rpa checkpoint", "--json"], env);
    expect(commands.result.data.commands.some((c: { usage: string }) => c.usage.includes("--plan"))).toBe(true);
    expect(run(["schema", "show", "blocky.rpa-recovery/v1", "--json"], env).code).toBe(0);
    const preview = run(["rpa", "recovery-preview", "checkpoint-../other", "--json"], env);
    expect(preview.result.error.code).toBe("BLK-RPA-JOURNAL-002");
    const planPath = join(dir, "plan.json"), recoveryPath = join(dir, "recovery.json");
    await writeFile(planPath, JSON.stringify({ schemaVersion: "blocky.rpa/v1", planId: "recover", target: { kind: "windows", identity: "unavailable" }, steps: [{ stepId: "read", action: "read", locator: { kind: "uia", automationId: "field" } }] }));
    await writeFile(recoveryPath, JSON.stringify({ schemaVersion: "blocky.rpa-recovery/v1", checkpointId: "checkpoint-missing", revision: 1, checks: [] }));
    const recovery = run(["rpa", "recover", planPath, "--recovery", recoveryPath, "--jsonl"], env);
    expect(recovery.code).toBe(7);
    expect(recovery.result.error.code).toBe("BLK-RPA-JOURNAL-001");
  } finally { await rm(dir, { recursive: true, force: true }); }
});
it("imports a recording as a pending review draft without typed values", async () => {
  const dir = await mkdtemp(resolve("try/stage7-rpa-"));
  try {
    const input = join(dir, "recording.json"), output = join(dir, "draft.json");
    await writeFile(input, JSON.stringify([{ action: "fill", locator: { kind: "browser", role: "textbox", name: "Password" }, sensitive: true, value: "SECRET_TEXT" }]));
    const created = run(["rpa", "recording-import", input, "--target-kind", "browser", "--target-identity", "https://example.test", "--plan-id", "plan-1", "--output", output, "--json"]);
    expect(created.code).toBe(0);
    const draft = await readFile(output, "utf8");
    expect(draft).not.toContain("SECRET_TEXT");
    expect(JSON.parse(draft).requiresReview).toBe(true);
    expect(JSON.parse(draft).plan.steps[0].value).toEqual({ kind: "manual-input", sensitive: true });
    const pending = run(["rpa", "validate", output, "--json"]);
    expect(pending.code).toBe(3); // pending draft is not an executable plan
    const plan = join(dir, "reviewed.json");
    await writeFile(plan, JSON.stringify(JSON.parse(draft).plan));
    expect(run(["rpa", "validate", plan, "--json"]).code).toBe(0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
it("discovers real native targets and exposes attended execution commands", () => {
  expect(parse(["rpa", "run", "plan.json", "--control-stdin", "--jsonl"]).options.get("control-stdin")).toBe(true);
  const targets = run(["rpa", "targets", "--json"]);
  expect(targets.code).toBe(0);
  expect(Array.isArray(targets.result.data.targets)).toBe(true);
  expect(targets.result.data.modelApiCalled).toBe(false);
  const commands = run(["command", "list", "--query", "rpa run", "--json"]);
  expect(commands.result.data.commands[0].usage).toContain("--control-stdin");
});
it("discovers explicit checkpoint deletion and rejects stale or malformed references", async () => {
  const commands = run(["command", "list", "--query", "checkpoint-delete", "--json"]);
  expect(commands.result.data.commands[0].usage).toContain("--revision");
  expect(run(["schema", "show", "blocky.rpa-checkpoint-delete/v1", "--json"]).code).toBe(0);
  const malformed = run(["rpa", "checkpoint-delete", "checkpoint-../outside", "--revision", "1", "--json"]);
  expect(malformed.code).toBe(3);
  expect(malformed.result.error.code).toBe("BLK-RPA-JOURNAL-002");
  const dir = await mkdtemp(resolve("try/stage7-rpa-delete-"));
  try {
    const missing = run(["rpa", "checkpoint-delete", `checkpoint-${crypto.randomUUID()}`, "--revision", "1", "--json"], { ...process.env, LOCALAPPDATA: dir, BLOCKY_PROFILE_DIR: join(dir, "ai.blocky.studio") });
    expect(missing.code).not.toBe(0);
    expect(missing.result.error.code).toBe("BLK-RPA-JOURNAL-001");
  } finally { await rm(dir, { recursive: true, force: true }); }
});
it("rejects unsupported native execution before opening an approval dialog", async () => {
  const dir = await mkdtemp(resolve("try/stage7-rpa-native-"));
  try {
    const plan = join(dir, "plan.json");
    await writeFile(plan, JSON.stringify({ schemaVersion: "blocky.rpa/v1", planId: "unsupported", target: { kind: "browser", identity: "https://example.test" }, steps: [{ stepId: "read", action: "read", locator: { kind: "browser", role: "textbox" }, timeoutMs: 100 }] }));
    const outcome = run(["rpa", "run", plan, "--jsonl"]);
    expect(outcome.code).toBe(7);
    expect(outcome.result.error.code).toBe("BLK-RPA-UNSUPPORTED-001");
    expect(outcome.result.data.completed).toBe(false);
    expect(outcome.result.data.modelApiCalled).toBe(false);
    const mismatch=run(["rpa","run",plan,"--browser-url","https://different.test/form","--project-id","browser-project","--jsonl"]);
    expect(mismatch.code).toBe(3);expect(mismatch.result.error.code).toBe("BLK-RPA-TARGET-001");
    const secretUrl=run(["rpa","run",plan,"--browser-url","https://user:password@example.test/","--project-id","browser-project","--jsonl"]);
    expect(secretUrl.code).toBe(3);expect(secretUrl.result.error.code).toBe("BLK-RPA-TARGET-001");
    expect(run(["schema","show","blocky.rpa-browser-start/v1","--json"]).code).toBe(0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
