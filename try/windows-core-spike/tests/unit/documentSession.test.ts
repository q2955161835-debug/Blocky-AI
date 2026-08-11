import { describe, expect, it } from "vitest";
import {
  createUntitledSession,
  formatDocumentLabel,
  reduceDocumentSession,
} from "../../src/app/DocumentSession";

describe("DocumentSession", () => {
  it("starts as an unsaved untitled document", () => {
    expect(createUntitledSession("empty-digest")).toMatchObject({
      displayName: "未命名 Agent",
      saveState: "dirty",
      hasFileAssociation: false,
      savedDigest: null,
      currentDigest: "empty-digest",
    });
  });

  it("tracks workspace, saving, success, and later edits without conflating digests", () => {
    const initial = createUntitledSession("empty-digest");
    const saving = reduceDocumentSession(initial, { type: "saveStarted" });
    expect(saving.saveState).toBe("saving");

    const saved = reduceDocumentSession(saving, {
      type: "saveSucceeded",
      documentId: "document-1",
      displayName: "weather.blocky",
      hasFileAssociation: true,
      savedDigest: "empty-digest",
    });
    expect(saved).toMatchObject({
      saveState: "clean",
      savedDigest: "empty-digest",
      currentDigest: "empty-digest",
    });
    expect(formatDocumentLabel(saved)).toBe("weather.blocky · 已保存");

    const edited = reduceDocumentSession(saved, {
      type: "workspaceAccepted",
      digest: "changed-digest",
    });
    expect(edited.saveState).toBe("dirty");
    expect(formatDocumentLabel(edited)).toBe("weather.blocky · 未保存");
  });

  it("keeps an edit made during a save dirty when the older digest completes", () => {
    const saving = reduceDocumentSession(createUntitledSession("first"), {
      type: "saveStarted",
    });
    const edited = reduceDocumentSession(saving, {
      type: "workspaceAccepted",
      digest: "second",
    });
    const savedOlderDigest = reduceDocumentSession(edited, {
      type: "saveSucceeded",
      documentId: "document-1",
      displayName: "agent.blocky",
      hasFileAssociation: true,
      savedDigest: "first",
    });
    expect(savedOlderDigest.saveState).toBe("dirty");
    expect(savedOlderDigest.savedDigest).toBe("first");
    expect(savedOlderDigest.currentDigest).toBe("second");
  });

  it("represents failed saving and an opened clean document explicitly", () => {
    const failed = reduceDocumentSession(createUntitledSession("empty"), {
      type: "saveFailed",
    });
    expect(failed.saveState).toBe("error");
    expect(formatDocumentLabel(failed)).toBe("未命名 Agent · 保存失败");

    const opened = reduceDocumentSession(failed, {
      type: "documentOpened",
      documentId: "document-8",
      displayName: "opened.blocky",
      digest: "opened-digest",
      hasFileAssociation: true,
    });
    expect(opened).toMatchObject({
      documentId: "document-8",
      displayName: "opened.blocky",
      saveState: "clean",
      savedDigest: "opened-digest",
      currentDigest: "opened-digest",
      hasFileAssociation: true,
    });
  });
});
