// @vitest-environment jsdom
import {
  fireEvent,
  render,
  screen,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { KnowledgePanel } from "../../apps/studio-desktop/src/app/KnowledgePanel";
import { KnowledgeQueryPanel } from "../../apps/studio-desktop/src/app/KnowledgeQueryPanel";
import { retrievalOptions } from "../../packages/knowledge-core/src/retrieval";
afterEach(cleanup);
it("reopens stored retrieval settings and retains all metadata filters on bind", async () => {
  let bound: unknown;
  const options = retrievalOptions({
    strategy: "hybrid",
    topK: 3,
    filters: { language: "en", sourceId: "s" },
  });
  render(
    <KnowledgeQueryPanel
      call={async () => null}
      projectId="p"
      collectionId="c"
      version="1"
      busy={false}
      canBind={true}
      initialOptions={options}
      run={async (work) => work(new AbortController().signal)}
      onBind={(value) => {
        bound = value;
      }}
    />,
  );
  expect((screen.getByLabelText("检索方式") as HTMLSelectElement).value).toBe(
    "hybrid",
  );
  expect((screen.getByLabelText("检索条数") as HTMLInputElement).value).toBe(
    "3",
  );
  fireEvent.click(screen.getByRole("button", { name: "用于当前知识积木" }));
  expect(bound).toMatchObject(options);
});
it("names failed sources and retries only incomplete snapshots", async () => {
  let value: unknown = null,
    revision = 0,
    broken = true;
  const reads: string[] = [];
  const call = async (op: string, fields: Record<string, unknown>) => {
    if (op === "knowledge-sources")
      return {
        generation: 1,
        sources: ["a", "b"].map((id) => ({
          sourceId: id,
          kind: "file",
          title: id === "a" ? "已完成资料" : "待修复资料",
          revision: "v1",
          readable: true,
          allowedPrincipals: ["local-user"],
          metadata: {},
        })),
      };
    if (op === "knowledge-load-index")
      return { value, revision, generation: 1 };
    if (op === "knowledge-save-index") {
      value = structuredClone(fields.value);
      return { revision: ++revision, generation: 1 };
    }
    if (op === "knowledge-read-source") {
      reads.push(String(fields.sourceId));
      if (fields.sourceId === "b" && broken) throw Error("private-path-canary");
      return {
        sourceId: fields.sourceId,
        revision: "v1",
        documents: [],
        excluded: [],
        nextCursor: null,
        generation: 1,
      };
    }
    throw Error(op);
  };
  render(
    <KnowledgePanel
      projectId="p"
      collectionId="c"
      call={call}
      onBind={() => {}}
    />,
  );
  await screen.findByText("待修复资料");
  fireEvent.click(screen.getByRole("button", { name: "同步资料" }));
  await screen.findByText(/待修复资料：读取未完成/);
  expect(document.body.textContent).not.toContain("private-path-canary");
  broken = false;
  reads.length = 0;
  fireEvent.click(screen.getByRole("button", { name: "继续同步未完成来源" }));
  await waitFor(() =>
    expect(screen.queryByText(/待修复资料：读取未完成/)).toBeNull(),
  );
  expect(reads).toEqual(["b"]);
});
it("imports a real source response and shows published document counts", async () => {
  let added = false,
    revision = 0,
    value: unknown = null,
    bound = false;
  const call = async (operation: string) => {
    if (operation === "knowledge-sources")
      return {
        generation: 1,
        sources: added
          ? [
              {
                sourceId: "source-a",
                kind: "file",
                title: "课堂资料",
                revision: "v1",
                readable: true,
                allowedPrincipals: ["local-user"],
                metadata: {},
              },
            ]
          : [],
      };
    if (operation === "knowledge-source-add") {
      added = true;
      return { sourceId: "source-a" };
    }
    if (operation === "knowledge-load-index")
      return { revision, generation: 1, value };
    if (operation === "knowledge-read-source")
      return {
        sourceId: "source-a",
        documents: [
          {
            documentId: "doc-water",
            title: "Water",
            text: "Water evaporation.",
            format: "text",
            revision: "v1",
            locator: { path: "water.txt", lineStart: 1, lineEnd: 1 },
            metadata: {},
          },
        ],
        revision: "v1",
        excluded: [],
        nextCursor: null,
        generation: 1,
      };
    throw Error(operation);
  };
  const gateway = async (op: string, fields: Record<string, unknown>) => {
    if (op === "knowledge-save-index") {
      value = structuredClone(fields.value);
      return { revision: ++revision, generation: 1 };
    }
    return call(op);
  };
  render(
    <KnowledgePanel
      projectId="project-a"
      collectionId="knowledge-a"
      call={gateway}
      onBind={() => {
        bound = true;
      }}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "添加文件" }));
  await screen.findByText("课堂资料");
  fireEvent.click(screen.getByRole("button", { name: "同步资料" }));
  await waitFor(() =>
    expect(screen.getByText(/1 份文档 · 1 个片段/)).toBeTruthy(),
  );
  fireEvent.click(screen.getByRole("button", { name: "用于当前知识积木" }));
  expect(bound).toBe(true);
});
it("reports a revoked source without exposing raw failures or silently claiming success", async () => {
  const call = async () => {
    throw Error("private-path-canary");
  };
  render(
    <KnowledgePanel
      projectId="project-b"
      collectionId="knowledge-b"
      call={call}
      onBind={() => {}}
    />,
  );
  await screen.findByRole("alert");
  expect(document.body.textContent).not.toContain("private-path-canary");
});
