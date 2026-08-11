import { describe, expect, it } from "vitest";
import { buildEditorProjection } from "../../src/blockly/BlocklyCanvas";
import { createHundredBlockWorkspaceState } from "../../src/blockly/fixtures";
import { stableStringify } from "../../src/core/json";
import { InMemoryHostBridge } from "../../src/host/InMemoryHostBridge";
import { createSpikeProjectSnapshot } from "../../src/project/SpikeProjectSnapshot";

function projectJson(): string {
  const projection = buildEditorProjection(createHundredBlockWorkspaceState());
  return stableStringify(createSpikeProjectSnapshot({
    projectId: "windows-core-spike",
    workspace: projection.workspace,
    program: projection.program,
    interactionManifest: projection.interactionManifest,
  }));
}

describe("native document HostBridge contract", () => {
  it("treats open cancellation as a normal null result", async () => {
    const host = new InMemoryHostBridge();
    expect(await host.openDocument()).toBeNull();
    host.queueCancelOpen();
    expect(await host.openDocument()).toBeNull();
  });

  it("returns only an opaque identity and display name for opened documents", async () => {
    const host = new InMemoryHostBridge();
    const json = projectJson();
    host.queueOpen(json, "weather.blocky");

    const opened = await host.openDocument();

    expect(opened).toMatchObject({
      displayName: "weather.blocky",
      json,
      hasFileAssociation: true,
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(opened).not.toHaveProperty("path");
    expect(opened?.documentId).toMatch(/^document-/);
  });

  it("associates the first save and preserves the association for later saves", async () => {
    const host = new InMemoryHostBridge();
    const json = projectJson();

    const first = await host.saveDocument({
      json,
      suggestedName: "天气助手",
      saveAs: false,
    });
    expect(first).toMatchObject({
      displayName: "天气助手.blocky",
      hasFileAssociation: true,
    });

    const second = await host.saveDocument({
      json,
      suggestedName: "ignored",
      saveAs: false,
    });
    expect(second?.documentId).toBe(first?.documentId);
    expect(second?.displayName).toBe("天气助手.blocky");

    await host.clearDocumentAssociation();
    const third = await host.saveDocument({
      json,
      suggestedName: "新文档.blocky",
      saveAs: false,
    });
    expect(third?.documentId).not.toBe(first?.documentId);
    expect(third?.displayName).toBe("新文档.blocky");
  });

  it("allows save-as cancellation without changing the current association", async () => {
    const host = new InMemoryHostBridge();
    const json = projectJson();
    const initial = await host.saveDocument({
      json,
      suggestedName: "initial.blocky",
      saveAs: false,
    });
    host.queueCancelSave();

    expect(await host.saveDocument({
      json,
      suggestedName: "cancelled.blocky",
      saveAs: true,
    })).toBeNull();

    const after = await host.saveDocument({
      json,
      suggestedName: "ignored.blocky",
      saveAs: false,
    });
    expect(after?.documentId).toBe(initial?.documentId);
    expect(after?.displayName).toBe("initial.blocky");
  });
});
