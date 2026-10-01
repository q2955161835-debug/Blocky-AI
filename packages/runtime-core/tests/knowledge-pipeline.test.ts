import { expect, it } from "vitest";
import {
  Runtime,
  hostAdapters,
  RemoteRuntime,
  RuntimeServiceHost,
} from "../src/index";
import {
  createCapabilityStarter,
  officialBlueprint,
  walkBlocks,
} from "../../block-catalog/src/index";
import { compileProject } from "@blocky/compiler";
import { parseProject } from "../../project-model/src/index";
import type { KnowledgeCall } from "@blocky/knowledge-core";
function fixture() {
  let revision = 0,
    value: unknown = null,
    generation = 1;
  const operations: string[] = [];
  const call: KnowledgeCall = async (op, fields) => {
    operations.push(op);
    if (op === "knowledge-sources")
      return {
        revision,
        generation,
        sources: [
          {
            sourceId: "source-one",
            kind: "file",
            title: "public.pdf",
            revision: "v1",
            readable: true,
            allowedPrincipals: ["local-user"],
            metadata: {},
          },
        ],
      };
    if (op === "knowledge-read-source")
      return {
        sourceId: "source-one",
        revision: "v1",
        generation,
        nextCursor: null,
        excluded: [],
        documents: [
          {
            documentId: "doc-one",
            title: "Public",
            text: "Plants need sunlight and water.",
            revision: "v1",
            format: "pdf",
            metadata: { parser: "blocky.document-result/v1" },
            locator: { path: "public.pdf", lineStart: 1, lineEnd: 1, page: 2 },
          },
        ],
      };
    if (op === "knowledge-load-index") return { revision, generation, value };
    if (op === "knowledge-save-index") {
      expect(fields.expectedRevision).toBe(revision);
      expect(fields.expectedGeneration).toBe(generation);
      value = structuredClone(fields.value);
      return { revision: ++revision, generation };
    }
    if (op === "knowledge-model-install") return { verified: true };
    if (op === "knowledge-embed-index") return { embedded: 1, reused: 0 };
    if (op === "knowledge-embedding-status")
      return { indexRevision: revision, generation, models: [] };
    if (op === "knowledge-cancel") return { cancelled: true };
    throw Error(op);
  };
  return {
    call,
    operations,
    get value() {
      return value;
    },
    revoke() {
      generation++;
    },
  };
}
it("runs an editable ingestion blueprint through shared domain services and retains page locations", async () => {
  const project = createCapabilityStarter(
      "knowledge-ingestion",
      "pipeline-project",
    ),
    f = fixture();
  expect((await compileProject(project)).diagnostics).toEqual([]);
  const run = await new Runtime({ adapters: hostAdapters(f.call) }).run(
    project,
    "on-question",
    "更新资料",
  );
  expect(run.status).toBe("completed");
  expect(
    run.events
      .filter((event) => event.type === "tool.completed")
      .map((event) => event.data.stage),
  ).toEqual(["source", "parse", "chunk", "sync", "embed", "index"]);
  expect(run.structured).toMatchObject({
    stage: "index",
    result: { generation: 1 },
  });
  expect(f.operations).toContain("knowledge-read-source");
  expect(f.operations).toContain("knowledge-embed-index");
  expect(f.operations.indexOf("knowledge-save-index")).toBeLessThan(
    f.operations.indexOf("knowledge-embed-index"),
  );
  expect(f.value).toMatchObject({
    pending: null,
    index: { chunks: [{ locator: { page: 2 } }] },
  });
  const blueprint = await officialBlueprint("knowledge-ingestion");
  expect([...walkBlocks(blueprint.roots)].map((block) => block.type)).toEqual(
    expect.arrayContaining([
      "core.knowledge.source",
      "core.knowledge.parse",
      "core.knowledge.chunk",
      "core.knowledge.sync",
      "core.knowledge.embed",
      "core.knowledge.index",
    ]),
  );
  expect(parseProject(JSON.parse(JSON.stringify(project)))).toEqual(project);
});
it("uses the same ingestion operations across the native runtime service boundary", async () => {
  const project = createCapabilityStarter(
      "knowledge-ingestion",
      "remote-pipeline",
    ),
    f = fixture();
  const host = new RuntimeServiceHost(
    project.manifest.projectId,
    hostAdapters(f.call),
  );
  const { readFile } = await import("node:fs/promises");
  const relay = await readFile(
    "apps/studio-host/src/workflow/desktop_run.rs",
    "utf8",
  );
  const allowed = [
    ...relay
      .split("const SERVICES:")[1]
      .split("];")[0]
      .matchAll(/"([a-z.-]+)"/g),
  ].map((match) => match[1]);
  const remote = new RemoteRuntime((request, signal) => {
    expect(allowed).toContain(request.service);
    return host.request(request, signal);
  });
  try {
    const run = await remote.run(
      {
        schemaVersion: "blocky.desktop-run/v1",
        project,
        interactionId: "on-question",
        question: "更新资料",
        options: {},
      },
      new AbortController().signal,
      () => {},
    );
    expect(run.result.status).toBe("completed");
    expect(f.operations).toContain("knowledge-embed-index");
  } finally {
    await host.close();
  }
});
it("denies missing permissions before ingestion can publish an index", async () => {
  const project = createCapabilityStarter(
      "knowledge-ingestion",
      "denied-pipeline",
    ),
    f = fixture();
  const run = await new Runtime({
    adapters: hostAdapters(f.call),
    capabilities: [],
  }).run(project, "on-question", "更新资料");
  expect(run.status).toBe("failed");
  expect(f.operations).not.toContain("knowledge-save-index");
});
it("uses the selected model to judge and rewrite retrieval while sharing the run budget", async () => {
  const project = createCapabilityStarter(
      "knowledge-correction",
      "corrected-project",
    ),
    f = fixture();
  const { knowledgeOperation } = await import("../../knowledge-core/src/index");
  await knowledgeOperation(
    f.call,
    project.manifest.projectId,
    "product-handbook",
    "sync",
  );
  const generationInputs: string[] = [];
  const adapters = hostAdapters(f.call, {
    generate: async (request) => {
      generationInputs.push(request.messages.at(-1)!.content);
      return {
        text: JSON.stringify(
          generationInputs.length === 1
            ? { action: "rewrite", query: "sunlight water" }
            : { action: "accept" },
        ),
        provider: "test-fixture",
        transport: "local",
        model: "test-judgment",
        requestId: request.requestId,
        usage: null,
      };
    },
  });
  // No remote API is called: the actual shared runtime is exercised with a deterministic judgment port.
  const run = await new Runtime({ adapters }).run(
    project,
    "on-question",
    "Plants",
  );
  expect(run.status).toBe("completed");
  expect(generationInputs.length).toBe(2);
  expect(generationInputs[1]).toContain('"originalQuestion":"Plants"');
  expect(run.citations.length).toBeGreaterThan(0);
  expect(run.generations?.length).toBe(2);
  expect(run.modelApiCalled).toBe(false);
  const blueprint = await officialBlueprint("knowledge-correction");
  expect(blueprint.resources.map((resource) => resource.kind).sort()).toEqual([
    "knowledge",
    "model",
  ]);
});
