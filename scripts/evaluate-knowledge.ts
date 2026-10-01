/** Real Host + frozen corpus evaluator. No fixture answers influence retrieval. */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, basename } from "node:path";
import { KnowledgeTransport } from "../tools/blocky-cli/src/knowledge-transport";
import {
  KnowledgeSearch,
  correctedQuery,
  scoreKnowledgeQuality,
  type QualityCase,
  knowledgePort,
  synchronize,
} from "../packages/knowledge-core/src/index";
import { renderAnswer } from "../packages/runtime-core/src/adapters";
import { Runtime, hostAdapters, nativeAgentServices } from "../packages/runtime-core/src/index";
import { createStarter } from "../packages/test-fixtures/src/index";
import { knowledgeResource } from "../packages/knowledge-core/src/resource";
import { upsertProjectResource } from "../packages/resource-registry/src/index";

import { AgentExecution } from '../packages/runtime-core/src/agent-execution';
import { RunBudget } from '../packages/runtime-core/src/budget';
import { userRegistryMap } from '../tools/blocky-cli/src/user-config';
import { nativeUserOperation } from '../tools/blocky-cli/src/native-store';
const option = (name: string) => { const at=process.argv.indexOf(name); return at<0 ? undefined : process.argv[at+1]; };
if (option('--profile-dir')) process.env.BLOCKY_PROFILE_DIR=resolve(option('--profile-dir')!);
const judgeId=option('--judge-model');
const capabilityMode = process.argv.includes("--capability");
if (capabilityMode && !judgeId) throw Error('BLK-KNOWLEDGE-JUDGMENT: capability quality requires --judge-model <configured-resource-id> through the real Host');
const fixturePath = resolve("packages/knowledge-core/fixtures/quality-v1.json");
const bytes = await readFile(fixturePath);
if (process.platform !== "win32")
  throw Error(
    "BLK-KNOWLEDGE-PLATFORM: this evaluator requires the real Windows Host and pinned models",
  );
const sha256 = createHash("sha256").update(bytes).digest("hex");
// Keep the frozen corpus identity explicit; do not silently accept edited cases.
if (
  sha256 !== "76270e2a5a96dafb397987957065d4b38c2eed62c54433b2dc6594ea92ddc9f0"
)
  throw Error(`Frozen quality corpus mismatch: ${sha256}`);
const fixture = JSON.parse(bytes.toString("utf8")) as {
  documents: { id: string; text: string; acl: string }[];
  cases: (QualityCase & { query: string })[];
};
const directory = resolve(
  capabilityMode ? "try/agent-capability-upgrade" : "try/stage3",
  `quality-${Date.now()}`,
);
await mkdir(resolve(directory, "allowed"), { recursive: true });
await mkdir(resolve(directory, "denied"), { recursive: true });
for (const doc of fixture.documents)
  await writeFile(
    resolve(
      directory,
      doc.acl === "denied" ? "denied" : "allowed",
      `${doc.id}.txt`,
    ),
    doc.text,
  );
process.env.LOCALAPPDATA = directory;
process.env.BLOCKY_MODEL_DIR ??= resolve(
  "try/stage3/models/multilingual-e5-small",
);
const transport = new KnowledgeTransport(
  resolve("tools/blocky-cli/dist/bin/blocky-project-io.exe"),
);
const fields = {
  projectId: `quality-evaluation-${Date.now()}`,
  collectionId: "frozen-corpus",
};
const call = async (operation: string, value: Record<string, unknown>) => {
  const reply = (await transport.request({
    schemaVersion: "blocky.project-io/v1alpha1",
    operation,
    ...value,
  })) as { ok: boolean; code?: string; value?: unknown };
  if (!reply.ok) throw Error(reply.code ?? "Host failed");
  return reply.value;
};
const registry = judgeId ? await userRegistryMap() : undefined;
const judgeModel = judgeId ? registry?.get(judgeId) : undefined;
if (judgeId && (!judgeModel || judgeModel.kind !== "model")) throw Error("BLK-MODEL-DEFAULT-001");
const services = nativeAgentServices(
  (operation, fields, signal) => nativeUserOperation(operation, fields, signal),
  { mode: "cli", live: true, approve: async () => true },
);
const judgmentReceipts: { caseId: string; strategy: string; provider: string; transport: string; model: string; requestId: string; usage: unknown; usageStatus: string }[] = [];
try {
  await call("knowledge-source-add", {
    ...fields,
    kind: "directory",
    path: resolve(directory, "allowed"),
  });
  const denied = (await call("knowledge-source-add", {
    ...fields,
    kind: "directory",
    path: resolve(directory, "denied"),
  })) as { sourceId: string };
  await call("knowledge-source-acl", {
    ...fields,
    sourceId: denied.sourceId,
    allowedPrincipals: [],
  });
  const sync = await synchronize(
    knowledgePort(call, fields.projectId, fields.collectionId),
  );
  if (sync.status !== "completed") throw Error(`Sync ${sync.status}`);
  const search = new KnowledgeSearch(
    call,
    fields.projectId,
    fields.collectionId,
  );
  const embedding = await search.embed();
  const repeatedEmbedding = await search.embed();
  const report: Record<string, unknown> = {
    fixtureSha256: sha256,
    fixtureCases: fixture.cases.length,
    embedding,
    repeatedEmbedding,
    externalModelApi: false,
    judgmentReceipts,
    rawSearch: {},
    strategies: {},
  };
  let passed = true;
  for (const strategy of ["keyword", "vector", "hybrid"] as const) {
    const cases = [];
    const rawCases = [];
    let hits = 0,
      reciprocalRanks = 0,
      citationCount = 0,
      validCitations = 0,
      leakage = 0;
    const timings: number[] = [];
    for (const item of fixture.cases) {
      const raw=await search.query(item.query,{strategy,topK:5});
      rawCases.push({id:item.id,status:raw.status,retrieved:raw.citations.map(c=>basename(c.locator.path,'.txt'))});
      let result=raw;
      if(judgeModel) {
        const budget=new RunBudget();
        const execution=new AgentExecution(createStarter(),item.query,'quality-'+crypto.randomUUID(),'quality-session',budget,services);
        execution.project.manifest.projectId=fields.projectId;
        try {
          result=await correctedQuery(search,item.query,{strategy,topK:5},(input)=>execution.judgeKnowledge(judgeModel,input),1,budget.signal);
          judgmentReceipts.push(...execution.generations.map(g=>({caseId:item.id,strategy,provider:g.provider,transport:g.transport,model:g.model,requestId:g.requestId,usage:g.usage,usageStatus:g.usageStatus??(g.usage?'reported':'unavailable')})));
        } finally { await services.close?.(budget.signal); budget.dispose(); }
      }
      timings.push(result.elapsedMs);
      const ids = result.citations.map((c) => basename(c.locator.path, ".txt"));
      const recall =
        item.kind === "answer"
          ? item.relevant.filter((id) => ids.includes(id)).length /
            item.relevant.length
          : null;
      if (recall !== null) hits += recall;
      if (item.kind === "answer") {
        const first = ids.findIndex((id) => item.relevant.includes(id));
        reciprocalRanks += first < 0 ? 0 : 1 / (first + 1);
      }
      for (const citation of result.citations) {
        citationCount++;
        const source = await search.openCitation(citation);
        if (source.text.includes(citation.text)) validCitations++;
        if (
          fixture.documents.some(
            (d) => d.acl === "denied" && citation.text.includes(d.text),
          )
        )
          leakage++;
      }
      const answer = renderAnswer(result.citations, "段落", "");
      const clarification = answer.includes("待核实");
      cases.push({
        id: item.id,
        kind: item.kind,
        retrieved: ids,
        recallAt5: recall,
        status: result.status,
        ...("correction" in result ? { correction: result.correction } : {}),
        clarification,
        elapsedMs: result.elapsedMs,
      });
    }
    (report.rawSearch as Record<string,unknown>)[strategy]=capabilityMode ? scoreKnowledgeQuality(fixture.cases,rawCases) : rawCases;
    report.externalModelApi=judgmentReceipts.some((g:any)=>g.transport==='remote');
    const warm = timings.slice(1).sort((a, b) => a - b);
    const recallAt5 =
      hits / fixture.cases.filter((c) => c.kind === "answer").length;
    const citationValidity = citationCount ? validCitations / citationCount : 0;
    const capabilityQuality = capabilityMode
      ? scoreKnowledgeQuality(fixture.cases, cases)
      : undefined;
    if (capabilityQuality) passed &&= capabilityQuality.passed;
    passed &&=
      recallAt5 >= (capabilityMode ? 0.9 : 0.85) &&
      citationValidity === 1 &&
      leakage === 0 &&
      cases.filter((c) => c.kind !== "answer").every((c) => c.clarification);
    (report.strategies as Record<string, unknown>)[strategy] = {
      recallAt5,
      ...(capabilityQuality ? { capabilityQuality } : {}),
      mrr:
        reciprocalRanks /
        fixture.cases.filter((c) => c.kind === "answer").length,
      citationCount,
      citationValidity,
      leakage,
      coldMs: timings[0],
      warmP50Ms: warm[Math.floor(warm.length * 0.5)],
      warmP95Ms: warm[Math.floor(warm.length * 0.95)],
      cases,
    };
    console.log(
      JSON.stringify({ strategy, recallAt5, citationValidity, leakage }),
    );
  }
  report.passed = passed;
  const resource = knowledgeResource("product-handbook", "Evaluation", {
    strategy: "hybrid",
  });
  resource.definition.collection = fields.collectionId;
  const starter = createStarter();
  starter.manifest.projectId = fields.projectId;
  const project = upsertProjectResource(starter, resource);
  const run = await new Runtime({ adapters: hostAdapters(call) }).run(
    project,
    "on-question",
    fixture.cases[0].query,
  );
  const runtimePassed =
    run.status === "completed" &&
    run.citations.length > 0 &&
    run.citations.every((c) => c.collectionId === fields.collectionId) &&
    run.answer.includes("相关资料摘录");
  report.runtime = {
    status: run.status,
    citationCount: run.citations.length,
    verifiedLocations: run.citations.every((c) => !!c.locator && !!c.revision),
    excerptOnly: run.answer.includes("相关资料摘录"),
    passed: runtimePassed,
  };
  passed &&= runtimePassed;
  report.passed = passed;
  report.outputMode =
    judgeModel ? "real-model-evidence-judgment-and-bounded-rewrite; excerpts-only-answer" : "raw-search-excerpts; no evidence-sufficiency-judgment";
  await writeFile(
    resolve(directory, "report.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(
    JSON.stringify({ report: resolve(directory, "report.json"), passed }),
  );
  if (!passed) process.exitCode = 1;
} finally {
  await transport.close();
}
