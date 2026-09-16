import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { compileProject } from "../../packages/compiler/src/index";
import { createStarter } from "../../packages/test-fixtures/src/index";
import {
  parseProject,
  projectDigest,
} from "../../packages/project-model/src/index";
import {
  canonicalJson,
  digest,
  validRef,
} from "../../packages/language-schema/src/index";
import { migrateProject } from "../../packages/project-migration/src/index";
import { encodeProject } from "../../packages/project-format/src/index";

describe("formal project compilation", () => {
  it("derives two modules, sources and typed links from actual Workspace blocks", async () => {
    const p = createStarter();
    const result = await compileProject(p);
    expect(result.diagnostics).toEqual([]);
    expect(result.modules).toHaveLength(2);
    expect(result.ir.links[0].target).toEqual({
      moduleId: "citation-service",
      exportId: "lookup-v1",
    });
    expect(result.modules[0].sourceMap["call-citation"]).toEqual({
      projectId: p.manifest.projectId,
      moduleId: "research-agent",
      blockId: "call-citation",
    });
    expect(result.interaction.entries[0].acceptedParts).toEqual(["text"]);
    expect(result.tools[0].implementationRef).toBe(
      "adapter://deterministic/knowledge-v1",
    );
  });
  it("keeps stable links and executable IR digest when display names change", async () => {
    const p = createStarter();
    const before = await compileProject(p);
    p.manifest.modules[1].displayName = "新的引用服务";
    p.manifest.modules[1].exports[0].displayName = "新标题";
    const after = await compileProject(p);
    expect(after.ir).toEqual(before.ir);
  });
  it("reports exactly the missing export root cause at the caller", async () => {
    const p = createStarter();
    p.manifest.modules[1].exports = [];
    const r = await compileProject(p);
    expect(r.diagnostics.map((d) => d.code)).toEqual(["BLK-LINK-002"]);
    expect(r.diagnostics[0].source?.blockId).toBe("call-citation");
  });
  it("rejects incompatible link schemas before execution", async () => {
    const p = createStarter();
    p.manifest.modules[1].exports[0].inputSchemaRef = "schemas/answer.json";
    expect((await compileProject(p)).diagnostics.map((d) => d.code)).toContain(
      "BLK-LINK-004",
    );
  });
  it("rejects synchronous cycles and relates both caller blocks", async () => {
    const p = createStarter();
    p.workspaces["citation-service"].blocks.blocks.push({
      type: "core.module.call",
      id: "back-call",
      fields: {
        MODULE: "research-agent",
        EXPORT: "answer-with-citations",
        INPUT: "schemas/question.json",
        OUTPUT: "schemas/answer.json",
      },
    });
    const r = await compileProject(p);
    expect(r.diagnostics.map((d) => d.code)).toContain("BLK-LINK-003");
    expect(
      r.diagnostics
        .find((d) => d.code === "BLK-LINK-003")
        ?.related.map((s) => s.blockId)
        .sort(),
    ).toEqual(["back-call", "call-citation"]);
  });
  it("rejects unknown blocks and duplicate block IDs without running them", async () => {
    const p = createStarter();
    p.workspaces["research-agent"].blocks.blocks.push({
      id: "on-question",
      type: "arbitrary.shell",
    });
    expect(
      (await compileProject(p)).diagnostics.some((d) => d.severity === "error"),
    ).toBe(true);
  });
  it("does not trust imported IR or include session fields in project facts", async () => {
    const p = createStarter();
    expect(() =>
      parseProject({ ...p, projectIr: { trusted: true } }),
    ).toThrow();
    expect(() => parseProject({ ...p, workspaceSession: {} })).toThrow();
    expect(await projectDigest(p)).toMatch(/^[a-f0-9]{64}$/);
  });
  it("explicitly migrates the original alpha manifest fixture through the shared migration boundary", async () => {
    const f = JSON.parse(
      readFileSync(
        "doc/技术设计/正式契约/fixtures/valid/minimal-multi-module-project.json",
        "utf8",
      ),
    );
    const p = createStarter();
    // Phase-zero fixture is a manifest-only contract; the current executable
    // workspace also needs its composer resource declared (never silently infer it).
    const composer = p.manifest.resources.find(
      (r) => r.resourceId === "local-composer",
    )!;
    p.manifest = {
      ...f.payload.project,
      schemaVersion: "blocky.project/v1",
      resources: [...f.payload.project.resources, composer],
    };
    const files = encodeProject(p);
    files["project.json"] = JSON.stringify({
      ...p.manifest,
      schemaVersion: "blocky.project/v1alpha1",
    });
    const migrated = await migrateProject(files);
    expect(migrated.diagnostics).toEqual([]);
    expect(migrated.project!.manifest.modules.map((m) => m.moduleId)).toEqual([
      "research-agent",
      "citation-service",
    ]);
  });
  it("rejects repeated module IDs and missing workspace files", () => {
    const p = createStarter();
    p.manifest.modules.push(structuredClone(p.manifest.modules[0]));
    expect(() => parseProject(p)).toThrow();
    const q = createStarter();
    delete q.workspaces["citation-service"];
    expect(() => parseProject(q)).toThrow();
  });
});
describe("canonical project references", () => {
  it.each([
    "../secret",
    "/root",
    "C:/file",
    "//server/file",
    "file://x",
    "a//b",
    "a/../b",
    "a\\b",
    "a\0b",
    "a:stream",
    "a/./b",
  ])("rejects unsafe reference %s", (value) =>
    expect(validRef(value)).toBe(false),
  );
  it("retains valid local references", () =>
    expect(validRef("workspaces/main.workspace.json")).toBe(true));
  it("canonicalizes nested keys without changing ordered arrays", async () => {
    expect(canonicalJson({ z: [2, 1], a: { b: 1, a: 2 } })).toBe(
      '{"a":{"a":2,"b":1},"z":[2,1]}',
    );
    expect(await digest({ a: 1 })).toBe(
      "015abd7f5cc57a2dd94b7590f04ad8084273905ee33ec5cebeae62276a97f862",
    );
    expect(() => canonicalJson({ x: Number.NaN })).toThrow();
  });
});
