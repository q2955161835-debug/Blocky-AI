import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildEditorProjection } from "../../src/blockly/BlocklyCanvas";
import { createHundredBlockWorkspaceState } from "../../src/blockly/fixtures";
import { stableStringify } from "../../src/core/json";
import {
  TauriHostBridge,
  type ProjectRecord,
} from "../../src/host/TauriHostBridge";
import { createSpikeProjectSnapshot } from "../../src/project/SpikeProjectSnapshot";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const invokeMock = vi.mocked(invoke);
const pathVectors = JSON.parse(
  readFileSync(
    resolve(process.cwd(), "tests/fixtures/path-sensitivity-vectors.json"),
    "utf8",
  ),
) as { sensitiveFragments: string[][] };
const sensitivePathVectors = pathVectors.sensitiveFragments.map((parts) =>
  parts.join(""),
);

function snapshot() {
  const projection = buildEditorProjection(createHundredBlockWorkspaceState());
  return createSpikeProjectSnapshot({
    projectId: "windows-core-spike",
    workspace: projection.workspace,
    program: projection.program,
    interactionManifest: projection.interactionManifest,
  });
}

function record(json: string): ProjectRecord {
  return {
    projectId: "windows-core-spike",
    json,
    sha256: "0".repeat(64),
    bytes: new TextEncoder().encode(json).byteLength,
  };
}

describe("TauriHostBridge", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("invokes only save_project with the canonical snapshot JSON", async () => {
    const project = snapshot();
    const json = stableStringify(project);
    invokeMock.mockResolvedValueOnce(record(json));

    await new TauriHostBridge().saveProject({ project });

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("save_project", {
      request: { projectId: "windows-core-spike", json },
    });
  });

  it("rejects a sensitive snapshot locally before invoking the host", async () => {
    const project = snapshot();
    const fragmentedToken = ["sk", "-", "x".repeat(24)].join("");
    const unsafeProject = {
      ...project,
      workspace: { blocks: { blocks: [], note: fragmentedToken } },
    };

    await expect(
      new TauriHostBridge().saveProject({ project: unsafeProject }),
    ).rejects.toMatchObject({
      code: "PROJECT_SENSITIVE_VALUE",
      message: "项目包含不允许保存的敏感值",
    });
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("invokes load_project and returns a Zod-validated snapshot", async () => {
    const project = snapshot();
    invokeMock.mockResolvedValueOnce(record(stableStringify(project)));

    const loaded = await new TauriHostBridge().loadProject("windows-core-spike");

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("load_project", {
      projectId: "windows-core-spike",
    });
    expect(loaded).toEqual(project);
  });

  it("rejects stored derived data that differs from a fresh workspace compile", async () => {
    const project = snapshot();
    const staleProject = {
      ...project,
      program: { ...project.program, roots: [] },
    };
    invokeMock.mockResolvedValueOnce(record(stableStringify(staleProject)));

    await expect(
      new TauriHostBridge().loadProject("windows-core-spike"),
    ).rejects.toMatchObject({
      code: "PROJECT_DERIVED_DATA_MISMATCH",
      message: "项目派生数据不一致",
    });
  });

  it("rejects a sensitive loaded snapshot even when all derived data is consistent", async () => {
    const workspace = {
      blocks: {
        languageVersion: 0,
        blocks: [
          {
            id: "literal-1",
            type: "core.data.literal",
            fields: { VALUE: sensitivePathVectors[1] },
          },
        ],
      },
    };
    const projection = buildEditorProjection(workspace);
    const sensitiveProject = createSpikeProjectSnapshot({
      projectId: "windows-core-spike",
      workspace: projection.workspace,
      program: projection.program,
      interactionManifest: projection.interactionManifest,
    });
    invokeMock.mockResolvedValueOnce(record(stableStringify(sensitiveProject)));

    await expect(
      new TauriHostBridge().loadProject("windows-core-spike"),
    ).rejects.toMatchObject({
      code: "PROJECT_SENSITIVE_VALUE",
      message: "项目包含不允许保存的敏感值",
    });
  });

  it("keeps unknown root keys as a strict bridge-layer rejection", async () => {
    const project = { ...snapshot(), unexpected: "value" };
    invokeMock.mockResolvedValueOnce(record(stableStringify(project)));

    await expect(
      new TauriHostBridge().loadProject("windows-core-spike"),
    ).rejects.toMatchObject({
      code: "PROJECT_JSON_INVALID",
      message: "项目 JSON 无效",
    });
  });

  it("rejects an unsupported snapshot schema with a stable safe code", async () => {
    const project = snapshot();
    const unsupported = { ...project, schemaVersion: "blocky.spike-project/v2" };
    invokeMock.mockResolvedValueOnce(record(stableStringify(unsupported)));

    await expect(
      new TauriHostBridge().loadProject("windows-core-spike"),
    ).rejects.toMatchObject({
      code: "PROJECT_SCHEMA_UNSUPPORTED",
      message: "项目格式版本不受支持",
    });
  });
});
