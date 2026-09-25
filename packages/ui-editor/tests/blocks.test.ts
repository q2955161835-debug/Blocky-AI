import { expect, it } from "vitest";
import { Blockly, registerBlocks } from "../src/blocks";
import { createStarter } from "../../test-fixtures/src/index";
import {
  captureBlueprint,
  instantiateBlueprint,
  defaultBindings,
  blueprintInstance,
  createBlueprintProject,
  officialStarters,
} from "../../block-catalog/src";
import { compileProject } from "../../compiler/src";
import type { Workspace } from "../../language-schema/src";
import { createTextProject } from "../../test-fixtures/src/text-project";
import { editSelection } from "../../project-model/src";
it("preserves editor group and note metadata through Blockly serialization", () => {
  registerBlocks();
  const source = createStarter().workspaces["research-agent"];
  editSelection(source, ["research-root"], { kind: "group", groupId: "group-study", label: "研究区域", region: true });
  editSelection(source, ["research-root"], { kind: "annotate", note: "检查证据" });
  const workspace = new Blockly.Workspace();
  try {
    Blockly.serialization.workspaces.load(source, workspace);
    const saved = Blockly.serialization.workspaces.save(workspace) as Workspace;
    expect(saved.blocks.blocks[0].data).toEqual(source.blocks.blocks[0].data);
  } finally { workspace.dispose(); }
});
it.each(officialStarters)(
  "$id preserves blueprint instance metadata, edited role and answer style through actual Blockly save/reload",
  async (starter) => {
    registerBlocks();
    const project = await createBlueprintProject(starter.id);
    const original = project.workspaces["research-agent"].blocks.blocks[0];
    const instance = blueprintInstance(original);
    expect(instance).toBeDefined();
    const expectedStyle =
      starter.id === "code-guide"
        ? "源码导览"
        : starter.id === "knowledge-tutor"
          ? "知识练习"
          : "条目";
    for (const [moduleId, source] of Object.entries(project.workspaces)) {
      const workspace = new Blockly.Workspace();
      const reloaded = new Blockly.Workspace();
      try {
        Blockly.serialization.workspaces.load(source, workspace);
        const count = workspace.getAllBlocks(false).length;
        if (moduleId === "research-agent") {
          workspace
            .getBlockById("research-root")!
            .setFieldValue("用户修改的角色", "ROLE");
          const answer = workspace.getBlockById("reply-answer");
          if (starter.id !== "task-helper")
            expect(answer!.getFieldValue("STYLE")).toBe(expectedStyle);
          else expect(answer).toBeNull();
        }
        // Cross a JSON boundary as project persistence does; use a fresh workspace.
        const saved = JSON.parse(
          JSON.stringify(Blockly.serialization.workspaces.save(workspace)),
        ) as Workspace;
        Blockly.serialization.workspaces.load(saved, reloaded);
        expect(reloaded.getAllBlocks(false)).toHaveLength(count);
        const roundTrip = Blockly.serialization.workspaces.save(
          reloaded,
        ) as Workspace;
        if (moduleId === "research-agent") {
          expect(roundTrip.blocks.blocks[0].extraState).toEqual(
            original.extraState,
          );
          expect(blueprintInstance(roundTrip.blocks.blocks[0])).toEqual(
            instance,
          );
          expect(
            reloaded.getBlockById("research-root")!.getFieldValue("ROLE"),
          ).toBe("用户修改的角色");
          if (starter.id !== "task-helper") {
            const answer = reloaded.getBlockById("reply-answer")!;
            expect(answer.getFieldValue("STYLE")).toBe(expectedStyle);
            answer.setFieldValue("段落", "STYLE");
            const edited = JSON.parse(
              JSON.stringify(Blockly.serialization.workspaces.save(reloaded)),
            ) as Workspace;
            Blockly.serialization.workspaces.load(edited, workspace);
            expect(
              workspace.getBlockById("reply-answer")!.getFieldValue("STYLE"),
            ).toBe("段落");
            expect(
              (Blockly.serialization.workspaces.save(workspace) as Workspace)
                .blocks.blocks[0].extraState,
            ).toEqual(original.extraState);
          }
        }
        project.workspaces[moduleId] = roundTrip;
      } finally {
        workspace.dispose();
        reloaded.dispose();
      }
    }
    expect(
      (await compileProject(project)).diagnostics.filter(
        (d) => d.severity === "error",
      ),
    ).toEqual([]);
  },
);
it("round-trips typed text/message value ports and JSON values in actual Blockly", () => {
  registerBlocks();
  const workspace = new Blockly.Workspace();
  try {
    Blockly.serialization.workspaces.load(
      createTextProject({ a: [1, true] }).workspaces.main,
      workspace,
    );
    const saved = Blockly.serialization.workspaces.save(workspace);
    expect(workspace.getTopBlocks(false)).toHaveLength(1);
    expect(workspace.getAllBlocks(false)).toHaveLength(6);
    const literal = workspace.getBlockById("literal-one")!;
    expect(literal.outputConnection?.getCheck()).toEqual(["json"]);
    expect(JSON.stringify(saved)).toContain('"VALUE":{"a":[1,true]}');
  } finally {
    workspace.dispose();
  }
});
it("preserves folded real Blockly stacks through blueprint insertion and expansion", async () => {
  registerBlocks();
  const project = createStarter(),
    workspace = new Blockly.Workspace();
  try {
    Blockly.serialization.workspaces.load(
      project.workspaces["research-agent"],
      workspace,
    );
    workspace.getBlockById("research-root")!.setCollapsed(true);
    project.workspaces["research-agent"] =
      Blockly.serialization.workspaces.save(workspace) as Workspace;
    const blueprint = await captureBlueprint(
      project,
      "research-agent",
      ["research-root"],
      "折叠问答",
    );
    const roots = await instantiateBlueprint(
      blueprint,
      project,
      "research-agent",
      defaultBindings(blueprint),
    );
    Blockly.serialization.workspaces.load(
      { blocks: { languageVersion: 0, blocks: roots } },
      workspace,
    );
    expect(workspace.getAllBlocks(false)).toHaveLength(5);
    const inserted = workspace.getBlockById(roots[0].id)!;
    inserted.setCollapsed(false);
    inserted.setFieldValue("教师", "ROLE");
    expect(inserted.getFieldValue("ROLE")).toBe("教师");
  } finally {
    workspace.dispose();
  }
});
it("loads and serializes real Blockly blocks with editable role and stable IDs", () => {
  registerBlocks();
  const workspace = new Blockly.Workspace();
  try {
    Blockly.serialization.workspaces.load(
      createStarter().workspaces["research-agent"],
      workspace,
    );
    const root = workspace.getBlockById("research-root")!;
    expect(root.type).toBe("core.agent");
    root.setFieldValue("教师", "ROLE");
    const saved = Blockly.serialization.workspaces.save(workspace);
    expect(JSON.stringify(saved)).toContain("教师");
    expect(workspace.getAllBlocks(false)).toHaveLength(5);
  } finally {
    workspace.dispose();
  }
});
