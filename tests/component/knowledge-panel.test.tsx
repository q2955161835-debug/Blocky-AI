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
afterEach(cleanup);
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
