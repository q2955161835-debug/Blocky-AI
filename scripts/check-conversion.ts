import { spawn } from "node:child_process";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  ConversionScanner,
  realConversionCandidate,
} from "../packages/conversion-core/src";
import { createTextProject } from "../packages/test-fixtures/src/text-project";
import { previewPatch } from "../packages/builder-protocol/src";
import { compileProject } from "../packages/compiler/src";
import { Runtime } from "../packages/runtime-core/src";
const directory = resolve(`try/stage3/conversion-${Date.now()}`);
await mkdir(directory, { recursive: true });
const executable = resolve(
  process.argv[2] ?? "apps/studio-host/target/debug/blocky-project-io.exe",
);
const localData = resolve(directory, "runtime");
const call = (operation: string, fields: Record<string, unknown>) =>
  new Promise<unknown>((resolveReply, reject) => {
    const child = spawn(executable, [], {
      windowsHide: true,
      env: { ...process.env, LOCALAPPDATA: localData },
    });
    let text = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (data) => {
      text += data;
    });
    child.stderr.resume();
    child.on("error", reject);
    child.on("close", (code) => {
      try {
        const reply = JSON.parse(text);
        if (code || !reply.ok) throw Error(reply.code ?? `exit:${code}`);
        resolveReply(reply.value);
      } catch (e) {
        reject(e);
      }
    });
    child.stdin.end(
      JSON.stringify({
        schemaVersion: "blocky.project-io/v1alpha1",
        operation,
        ...fields,
      }),
    );
  });
const scanner = new ConversionScanner(call, "stage3-conversion-validation");
const artifact = await scanner.scan({
  path: resolve("try/stage3/upstream/haystack"),
  ref: "d72ed6cb37abebaefda8da39e3e7a5d8fffb2065",
  subdir: "haystack/components/retrievers/in_memory",
});
const report = await scanner.analyze(artifact);
await writeFile(
  resolve(directory, "haystack-report.json"),
  JSON.stringify(report, null, 2),
);
const bm25 = report.files.find((f) => f.path.endsWith("bm25_retriever.py"));
if (
  !bm25 ||
  report.licenseStatus !== "Apache-2.0" ||
  !bm25.symbols.some((s) => s.name === "run")
)
  throw Error("Real Haystack evidence missing");
if (bm25.symbols.some((s) => s.program))
  throw Error("BM25 must not claim algorithm conversion");
const reused = await scanner.analyze(artifact);
if (reused.stats.analyzed !== 0 || reused.stats.reused !== artifact.fileCount)
  throw Error("Cache reuse failed");
// An owned source repository exercises real Git scanning and generated runtime behavior.
const repository = resolve(directory, "numeric-repo");
await mkdir(repository);
await writeFile(
  resolve(repository, "LICENSE"),
  await readFile("vendor/models/licenses/LICENSE.e5", "utf8"),
);
await writeFile(
  resolve(repository, "math.ts"),
  "function double(x: number): number { return x * 2; }\nexport function flow(x: number): number { return double(x) + 3; }\n",
);
const git = (args: string[]) =>
  new Promise<void>((done, reject) => {
    const p = spawn("git", ["-C", repository, ...args], {
      windowsHide: true,
      stdio: "ignore",
    });
    p.on("error", reject);
    p.on("close", (code) => (code ? reject(Error("git failed")) : done()));
  });
await git(["init"]);
await git(["add", "."]);
await git([
  "-c",
  "user.name=Blocky test",
  "-c",
  "user.email=test@example.invalid",
  "commit",
  "-m",
  "owned numeric source",
]);
const ownArtifact = await scanner.scan({ path: repository }),
  ownReport = await scanner.analyze(ownArtifact);
const candidate = await realConversionCandidate(
  createTextProject("original"),
  "main",
  ownReport,
  { file: "math.ts", symbol: "flow", lineStart: 2 },
  scanner,
);
const preview = await previewPatch(
  createTextProject("original"),
  candidate.patch,
);
const compiled = await compileProject(preview.next),
  entry = compiled.interaction.entries.find(
    (e) => e.interactionId !== "entry-one",
  )!;
const runs = [];
for (const x of [-3, 0, 1.5, 8]) {
  const run = await new Runtime().run(
    preview.next,
    entry.interactionId,
    JSON.stringify({ x }),
    { moduleId: "main" },
  );
  if (run.status !== "completed" || run.answer !== String(x * 2 + 3))
    throw Error("Converted behavior mismatch");
  runs.push({ x, answer: run.answer, status: run.status });
}
const summary = {
  artifact,
  license: report.licenseStatus,
  bm25: bm25.symbols.map((s) => ({
    name: s.name,
    lineStart: s.lineStart,
    lineEnd: s.lineEnd,
    decision: s.decision,
  })),
  reused: reused.stats,
  generated: {
    source: candidate.source,
    artifactType: candidate.artifactType,
    runs,
  },
  externalModelApi: false,
};
await writeFile(
  resolve(directory, "summary.json"),
  JSON.stringify(summary, null, 2),
);
console.log(JSON.stringify({ directory, ...summary }));
