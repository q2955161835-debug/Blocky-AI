import { mkdir, writeFile, readdir, stat, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { cpus, totalmem } from "node:os";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { KnowledgeTransport } from "../tools/blocky-cli/src/knowledge-transport";
import {
  KnowledgeSearch,
  knowledgePort,
  synchronize,
} from "../packages/knowledge-core/src/index";

const count = Number(process.argv[2] ?? 100);
if (![100, 1000, 10000].includes(count))
  throw Error("Use 100, 1000 or 10000 documents");
const corpusBytes = (count / 100) * 1024 * 1024;
const limitMs = count === 100 ? 500 : count === 1000 ? 1500 : 3000;
const resumed = process.argv[3] !== undefined;
const directory = resumed ? resolve(process.argv[3]) : resolve("try/stage3", `performance-${count}-${Date.now()}`);
if (!directory.startsWith(resolve("try/stage3", `performance-${count}-`))) throw Error("Resume must name this benchmark's project-local directory");
const reportPath = resolve(directory, resumed ? `report-resumed-${Date.now()}.json` : "report.json");
const corpus = resolve(directory, "corpus");
await mkdir(corpus, { recursive: true });
const topics = [
  "planet",
  "robot",
  "library",
  "garden",
  "weather",
  "compiler",
  "document",
  "permission",
  "laboratory",
  "archive",
];
// Every document/record has a distinct identity and payload, not empty/repeated files.
// Synthetic distribution is versioned and disclosed; it is not a real-user dataset.
function document(n: number, changed = false) {
  const size =
    Math.floor(corpusBytes / count) + (n < corpusBytes % count ? 1 : 0);
  let text = `Document ${n}: ${topics[n % topics.length]} maintenance notes. Revision ${changed ? "B" : "A"}.\n`;
  for (let row = 0; text.length < size; row++)
    text += `Record ${n}-${row}: ${topics[(n + row) % topics.length]} sample ${n * 31 + row} uses station ${n % 47}, records measured value ${(n * 7 + row * 11) % 997}, preserves original source references and checks access permissions before sharing information.\n`;
  return text.slice(0, size);
}
const hash = createHash("sha256");
for (let n = 0; n < count; n++) {
  const text = document(n);
  hash.update(text);
  await writeFile(
    resolve(corpus, `record-${String(n).padStart(5, "0")}.txt`),
    text,
  );
}
process.env.LOCALAPPDATA = directory;
process.env.BLOCKY_MODEL_DIR ??= resolve(
  "try/stage3/models/multilingual-e5-small",
);
const helper = resolve("apps/studio-host/target/release/blocky-project-io.exe");
const transport = new KnowledgeTransport(helper);
const fields = { projectId: "performance-evaluation", collectionId: "corpus" };
const call = async (operation: string, value: Record<string, unknown>) => {
  const reply = (await transport.request({
    schemaVersion: "blocky.project-io/v1alpha1",
    operation,
    ...value,
  })) as { ok: boolean; code?: string; value?: unknown };
  if (!reply.ok) throw Error(reply.code ?? "Host failed");
  return reply.value;
};
const port = knowledgePort(call, fields.projectId, fields.collectionId);
const search = new KnowledgeSearch(call, fields.projectId, fields.collectionId);
let nodePeak = process.memoryUsage().rss;
const sample = setInterval(() => {
  nodePeak = Math.max(nodePeak, process.memoryUsage().rss);
}, 100);
function hostMemory() {
  // Read-only diagnostics of the exact child created by this transport.
  const childId = (transport as unknown as { child?: { pid?: number } }).child
    ?.pid;
  if (!childId || !Number.isSafeInteger(childId))
    throw Error("Missing Host process");
  const result = spawnSync(
    "pwsh",
    [
      "-NoProfile",
      "-Command",
      `$p=Get-Process -Id ${childId}; @{workingSet=$p.WorkingSet64;peakWorkingSet=$p.PeakWorkingSet64;privateBytes=$p.PrivateMemorySize64}|ConvertTo-Json -Compress`,
    ],
    { encoding: "utf8", windowsHide: true },
  );
  if (result.status !== 0) throw Error("Memory measurement unavailable");
  return JSON.parse(result.stdout);
}
async function timed<T>(fn: () => Promise<T>) {
  const start = performance.now();
  const value = await fn();
  return { elapsedMs: performance.now() - start, value };
}
async function disk(path: string): Promise<number> {
  let size = 0;
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const child = resolve(path, entry.name);
    if (entry.isDirectory()) size += await disk(child);
    else if (entry.isFile()) size += (await stat(child)).size;
  }
  return size;
}
const report: Record<string, unknown> = {
  resumedWithExistingEmbeddingCache: resumed,
  generator: "unique-ascii-records/v1",
  documents: count,
  corpusBytes,
  corpusSha256: hash.digest("hex"),
  helperSha256: createHash("sha256")
    .update(await readFile(helper))
    .digest("hex"),
  hardware: {
    cpu: cpus()[0]?.model,
    logicalProcessors: cpus().length,
    memoryBytes: totalmem(),
  },
  externalModelApi: false,
  thresholds: {
    warmP95Ms: limitMs,
    memoryBytes: 2 * 1024 ** 3,
    indexRatio: 10,
  },
};
try {
  await call("knowledge-source-add", {
    ...fields,
    kind: "directory",
    path: corpus,
  });
  report.firstSync = await timed(() => synchronize(port));
  console.log(
    JSON.stringify({
      phase: "synchronized",
      count,
      ...(report.firstSync as object),
    }),
  );
  report.modelLoad = await timed(() => call("knowledge-model-install", fields));
  report.modelResidentMemory = hostMemory();
  report.embedding = await timed(() => search.embed());
  console.log(
    JSON.stringify({
      phase: "embedded",
      count,
      ...(report.embedding as object),
    }),
  );
  const cold: Record<string, unknown> = {},
    measurements: { strategy: string; elapsedMs: number }[] = [];
  for (const strategy of ["keyword", "vector", "hybrid"] as const)
    cold[strategy] = (
      await search.query("Which archive records preserve source references?", {
        strategy,
      })
    ).elapsedMs;
  for (let i = 0; i < 100; i++) {
    const strategy = (["keyword", "vector", "hybrid"] as const)[i % 3];
    const result = await search.query(
      `How does ${topics[i % topics.length]} station ${i % 47} check permissions and record measured values?`,
      { strategy },
    );
    measurements.push({ strategy, elapsedMs: result.elapsedMs });
  }
  const summarize = (values: number[]) => {
    values.sort((a, b) => a - b);
    return {
      count: values.length,
      p50Ms: values[Math.floor(values.length * 0.5)],
      p95Ms: values[Math.floor(values.length * 0.95)],
    };
  };
  report.cold = cold;
  report.warm = summarize(measurements.map((m) => m.elapsedMs));
  report.byStrategy = Object.fromEntries(
    ["keyword", "vector", "hybrid"].map((s) => [
      s,
      summarize(
        measurements.filter((m) => m.strategy === s).map((m) => m.elapsedMs),
      ),
    ]),
  );
  report.repeatedEmbedding = await timed(() => search.embed());
  for (let n = 0; n < count / 10; n++)
    await writeFile(
      resolve(corpus, `record-${String(n).padStart(5, "0")}.txt`),
      document(n, true),
    );
  report.incrementalSync = await timed(() => synchronize(port));
  report.incrementalEmbedding = await timed(() => search.embed());
  report.hostMemory = hostMemory();
  report.nodePeakBytes = Math.max(
    nodePeak,
    process.resourceUsage().maxRSS * 1024,
  );
  report.indexBytes = await disk(resolve(directory, "ai.blocky.studio"));
  report.indexRatio = Number(report.indexBytes) / corpusBytes;
  report.measurements = measurements;
  report.passedMeasuredBudgets =
    (report.warm as { p95Ms: number }).p95Ms <= limitMs &&
    Number(report.nodePeakBytes) <= 2 * 1024 ** 3 &&
    (report.hostMemory as { peakWorkingSet: number }).peakWorkingSet <=
      2 * 1024 ** 3 &&
    Number(report.indexRatio) <= 10;
  console.log(
    JSON.stringify({
      report: reportPath,
      warm: report.warm,
      nodePeakBytes: report.nodePeakBytes,
      hostMemory: report.hostMemory,
      indexRatio: report.indexRatio,
      passed: report.passedMeasuredBudgets,
    }),
  );
} catch (error) {
  report.error = error instanceof Error ? error.message : "benchmark failed";
  process.exitCode = 1;
  console.error(report.error);
} finally {
  clearInterval(sample);
  report.nodePeakBytes = Math.max(nodePeak, process.resourceUsage().maxRSS * 1024);
  await writeFile(
    reportPath,
    JSON.stringify(report, null, 2),
  );
  await transport.close();
}
