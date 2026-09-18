import { expect, it } from "vitest";
import { compileProject } from "../../compiler/src";
import { Runtime, localAdapters, type Citation } from "../../runtime-core/src";
import { renderAnswer } from "../../runtime-core/src/adapters";
import { createOfficialStarter, officialStarters } from "../src/starters";
import {
  blueprintInstance,
  createBlueprintProject,
  defaultBindings,
  instantiateBlueprint,
  officialBlueprint,
} from "../src";
import type { WorkspaceBlock } from "@blocky/language-schema";

function blocks(root: WorkspaceBlock): WorkspaceBlock[] {
  return [
    root,
    ...Object.values(root.inputs ?? {}).flatMap((input) =>
      input.block ? blocks(input.block) : [],
    ),
    ...(root.next?.block ? blocks(root.next.block) : []),
  ];
}
const evidence: Citation = {
  id: "chunk-test",
  title: "算术函数",
  text: "export const add = (a, b) => a + b;",
  collectionId: "product-handbook",
  sourceId: "source-test",
  documentId: "document-test",
  revision: "a".repeat(64),
  digest: "b".repeat(64),
  locator: {
    path: "src/math.ts",
    lineStart: 3,
    lineEnd: 5,
    commit: "c".repeat(40),
  },
  score: 0.8,
  truncated: false,
};
it.each(officialStarters)(
  "$id official blueprint compiles and exposes working role and resource/tool bindings",
  async (starter) => {
    const project = await createBlueprintProject(starter.id);
    const blueprint = await officialBlueprint(starter.id);
    expect(blueprint.source).toEqual({
      kind: "official",
      starterId: starter.id,
    });
    expect(blueprint.version).toBe(1);
    const initialRoot = project.workspaces["research-agent"].blocks.blocks[0];
    expect(blueprintInstance(initialRoot)).toMatchObject({
      blueprintId: blueprint.blueprintId,
      digest: blueprint.digest,
      version: 1,
    });
    expect(
      (await compileProject(project)).diagnostics.filter(
        (d) => d.severity === "error",
      ),
    ).toEqual([]);
    expect(blueprint.parameters).toHaveLength(1);
    const roleSlot = blueprint.parameters[0];
    expect(
      blocks(blueprint.roots[0]).find((b) => b.id === roleSlot.blockId)?.fields
        ?.ROLE,
    ).toBe(roleSlot.defaultValue);
    const bindings = defaultBindings(blueprint);
    bindings.parameters![roleSlot.slotId] = "只依据我选择的来源整理";
    const adapters = localAdapters();
    let observedCollection = "";
    adapters.knowledge.set(
      "adapter://knowledge-local-v1",
      async (_question, collection) => {
        observedCollection = collection;
        return [evidence];
      },
    );
    if (starter.id === "task-helper") {
      expect(blueprint.resources).toEqual([]);
      expect(blueprint.modules).toHaveLength(1);
      const slot = blueprint.modules[0];
      expect(slot).toMatchObject({
        defaultModuleId: "citation-service",
        exportId: "calculate-v1",
      });
      expect(
        blocks(blueprint.roots[0]).find((b) => b.type === "core.module.call")
          ?.fields?.MODULE,
      ).toBe(slot.slotId);
      bindings.modules[slot.slotId] = "minutes-service";
    } else {
      const slots = blueprint.resources.filter(
        (slot) => slot.kind === "knowledge",
      );
      expect(slots).toHaveLength(1);
      const slot = slots[0];
      expect(
        blocks(blueprint.roots[0]).find(
          (b) => b.type === "core.knowledge.retrieve",
        )?.fields?.RESOURCE,
      ).toBe(slot.slotId);
      const resource = structuredClone(
        project.resources[slot.defaultResourceId],
      );
      resource.resourceId = "selected-knowledge";
      resource.definition.collection = "selected-knowledge";
      resource.definition.sourceRef = {
        kind: "resource",
        id: "selected-knowledge",
      };
      project.resources[resource.resourceId] = resource;
      project.manifest.resources.push({
        resourceId: resource.resourceId,
        kind: "knowledge",
        scope: "project",
        definitionRef: "resources/selected-knowledge.json",
        secretRefs: [],
      });
      bindings.resources[slot.slotId] = resource.resourceId;
    }
    project.workspaces["research-agent"].blocks.blocks = [];
    const roots = await instantiateBlueprint(
      blueprint,
      project,
      "research-agent",
      bindings,
      { x: 80, y: 70 },
      (id) => id,
    );
    project.workspaces["research-agent"].blocks.blocks = roots;
    expect(roots[0].fields?.ROLE).toBe("只依据我选择的来源整理");
    expect(
      (await compileProject(project)).diagnostics.filter(
        (d) => d.severity === "error",
      ),
    ).toEqual([]);
    const result = await new Runtime({ adapters }).run(
      project,
      "on-question",
      starter.sampleInput,
    );
    expect(result.status).toBe("completed");
    if (starter.id === "task-helper") expect(result.answer).toBe("45");
    else {
      expect(observedCollection).toBe("selected-knowledge");
      expect(result.citations).toEqual([evidence]);
    }
  },
);
it("four distinct official starters compile with isolated project identities and empty Host-backed knowledge", async () => {
  expect(officialStarters.map((starter) => starter.id)).toEqual([
    "research-companion",
    "code-guide",
    "knowledge-tutor",
    "task-helper",
  ]);
  for (const starter of officialStarters) {
    expect(starter.version).toBe(1);
    expect(starter.steps.length).toBeGreaterThan(1);
    const project = createOfficialStarter(starter.id);
    expect(project.manifest.projectId).not.toBe(
      createOfficialStarter(starter.id).manifest.projectId,
    );
    expect(
      (await compileProject(project)).diagnostics.filter(
        (d) => d.severity === "error",
      ),
    ).toEqual([]);
    expect(project.workspaces["research-agent"].blocks.blocks[0].id).toBe(
      "research-root",
    );
    if (starter.id !== "task-helper") {
      expect(project.manifest.modules).toHaveLength(2);
      const resource = project.resources["product-handbook"];
      expect(resource.definition.implementationRef).toEqual({
        kind: "adapter",
        id: "knowledge-local-v1",
      });
      expect(resource.secretBindings).toEqual([]);
      expect(JSON.stringify(project)).not.toContain(
        "deterministic/knowledge-v1",
      );
      expect(resource.definition).not.toHaveProperty("documents");
    }
  }
});
it("the three knowledge runs transform only supplied evidence into distinct research, code and learning outputs", async () => {
  const outputs: string[] = [];
  for (const id of ["research-companion", "code-guide", "knowledge-tutor"]) {
    const project = createOfficialStarter(id, "starter-proof");
    project.workspaces["research-agent"].blocks.blocks[0].fields!.ROLE =
      "可编辑角色";
    const adapters = localAdapters();
    let observed = "";
    adapters.knowledge.set("adapter://knowledge-local-v1", async () => [
      evidence,
    ]);
    adapters.model.set("adapter://deterministic/composer-v1", async (input) => {
      observed = input.role;
      return input.citations;
    });
    const result = await new Runtime({ adapters }).run(
      project,
      "on-question",
      "阅读这段源码",
    );
    expect(result.status).toBe("completed");
    expect(observed).toBe("可编辑角色");
    expect(result.citations).toEqual([evidence]);
    expect(result.answer).toContain(evidence.text);
    outputs.push(result.answer);
  }
  expect(outputs[0]).toContain("相关资料摘录");
  expect(outputs[0]).toContain("尚不能确认完整回答了问题");
  expect(outputs[1]).toContain("src/math.ts:3–5");
  expect(outputs[1]).toContain("阅读任务");
  expect(outputs[1]).toContain("未运行");
  expect(outputs[2]).toContain("复述");
  expect(outputs[2]).toContain("没有自动评分");
  expect(new Set(outputs).size).toBe(3);
});
it("empty knowledge never falls back to bundled fixture answers and old fixture formatting remains unchanged", async () => {
  for (const id of ["research-companion", "code-guide", "knowledge-tutor"]) {
    const project = createOfficialStarter(id);
    const adapters = localAdapters();
    adapters.knowledge.set("adapter://knowledge-local-v1", async () => []);
    const result = await new Runtime({ adapters }).run(
      project,
      "on-question",
      "水循环",
    );
    expect(result.status).toBe("completed");
    expect(result.answer).toContain("待核实");
    expect(result.citations).toEqual([]);
    const unavailable = await new Runtime().run(
      project,
      "on-question",
      "水循环",
    );
    expect(unavailable.status).toBe("failed");
    expect(unavailable.answer).toBe("");
  }
  expect(
    renderAnswer(
      [{ id: "old", title: "原有", text: "旧内容" }],
      "条目",
      "教师",
    ),
  ).toBe("学习要点\n\n• 旧内容 [原有]");
  expect(renderAnswer([], "条目", "研究")).toBe("课程资料没有说明，待核实。");
});
it("task helper computes bounded numeric hours, switches to minutes, and rejects invalid input without I/O", async () => {
  const project = createOfficialStarter("task-helper");
  const input = officialStarters.find(
    (s) => s.id === "task-helper",
  )!.sampleInput;
  expect(JSON.parse(input)).toEqual({ count: 3, minutes: 15 });
  expect(Object.keys(project.resources)).toEqual([]);
  const runtime = new Runtime({
    capabilities: [],
    adapters: { knowledge: new Map(), model: new Map() },
  });
  const hours = await runtime.run(project, "on-question", input);
  expect(hours.status).toBe("completed");
  expect(hours.answer).toBe("0.75");
  const call = blocks(
    project.workspaces["research-agent"].blocks.blocks[0],
  ).find((b) => b.type === "core.module.call")!;
  call.fields!.MODULE = "minutes-service";
  expect(
    (await compileProject(project)).diagnostics.filter(
      (d) => d.severity === "error",
    ),
  ).toEqual([]);
  expect((await runtime.run(project, "on-question", input)).answer).toBe("45");
  for (const invalid of [
    '{"count":"3","minutes":15}',
    '{"count":1000000001,"minutes":1}',
    '{"count":3,"minutes":15,"command":"exec"}',
  ]) {
    const result = await runtime.run(project, "on-question", invalid);
    expect(result.status).toBe("failed");
    expect(result.answer).toBe("");
    expect(result.events.at(-1)?.data.code).toBe("BLK-EXPR-002");
  }
});
it("unknown starter ids fail and returned projects do not share mutable blocks", () => {
  expect(() => createOfficialStarter("invented")).toThrow("BLK-STARTER-001");
  const first = createOfficialStarter("research-companion", "fixed-id");
  const second = createOfficialStarter("research-companion", "fixed-id");
  first.workspaces["research-agent"].blocks.blocks[0].fields!.ROLE = "changed";
  expect(
    second.workspaces["research-agent"].blocks.blocks[0].fields!.ROLE,
  ).not.toBe("changed");
});

it("code guidance does not invent or expose invalid source locations", () => {
  for (const locator of [
    undefined,
    { path: "/outside/private.ts", lineStart: 3, lineEnd: 5 },
    { path: "src/math.ts", lineStart: 0, lineEnd: 5 },
    { path: "src/math.ts", lineStart: 8, lineEnd: 5 },
  ]) {
    const answer = renderAnswer(
      [{ ...evidence, locator }],
      "源码导览",
      "代码阅读",
    );
    expect(answer).toContain("来源位置未提供，待核实");
    expect(answer).not.toContain("/outside/private.ts");
    expect(answer).toContain(evidence.text);
  }
});
