import { expect, it } from "vitest";
import { Blockly, registerBlocks } from "../src/blocks";
import { createStarter } from "../../test-fixtures/src/index";
import {
  captureBlueprint,
  instantiateBlueprint,
  defaultBindings,
  blueprintInstance,
} from "../../block-catalog/src";
import { createCapabilityStarter } from "../../test-fixtures/src/scenarios";
import { compileProject } from "../../compiler/src";
import type { Workspace } from "../../language-schema/src";
import { createTextProject } from "../../test-fixtures/src/text-project";
import { editSelection } from "../../project-model/src";
it("round-trips typed workflow steps and approval fields through real Blockly connections", () => {
  registerBlocks();
  const workspace = new Blockly.Workspace(),
    reloaded = new Blockly.Workspace();
  try {
    const root = workspace.newBlock("runtime.task.durable", "workflow");
    const step = workspace.newBlock("runtime.compensate", "step");
    const action = workspace.newBlock("core.data.set", "action");
    action.setFieldValue("1", "VALUE");
    const approval = workspace.newBlock("core.human.approve", "approval");
    approval.setFieldValue("确认继续", "LABEL");
    const checkpoint = workspace.newBlock(
      "runtime.checkpoint.save",
      "checkpoint",
    );
    root.getInput("STEPS")!.connection!.connect(step.previousConnection!);
    step.getInput("DO")!.connection!.connect(action.previousConnection!);
    step.nextConnection!.connect(approval.previousConnection!);
    approval.nextConnection!.connect(checkpoint.previousConnection!);
    expect(step.previousConnection!.getCheck()).toEqual(["workflow-step"]);
    const saved = JSON.parse(
      JSON.stringify(Blockly.serialization.workspaces.save(workspace)),
    );
    Blockly.serialization.workspaces.load(saved, reloaded);
    expect(
      reloaded.getBlockById("workflow")!.getInputTargetBlock("STEPS")!.id,
    ).toBe("step");
    expect(reloaded.getBlockById("step")!.getInputTargetBlock("DO")!.id).toBe(
      "action",
    );
    expect(
      reloaded.getBlockById("step")!.getInputTargetBlock("UNDO"),
    ).toBeNull();
    expect(reloaded.getBlockById("approval")!.getFieldValue("LABEL")).toBe(
      "确认继续",
    );
    expect(reloaded.getBlockById("approval")!.getNextBlock()!.id).toBe(
      "checkpoint",
    );
  } finally {
    workspace.dispose();
    reloaded.dispose();
  }
});
it("uses catalog defaults and typed tool-flow Blockly connections", () => {
  registerBlocks();
  const workspace = new Blockly.Workspace();
  try {
    const loop = workspace.newBlock("core.reason.tool_loop");
    const tool = workspace.newBlock("core.tool.expose");
    const repeat = workspace.newBlock("core.flow.repeat");
    const foreach = workspace.newBlock("core.flow.foreach");
    const whileBlock = workspace.newBlock("core.flow.while");
    const retry = workspace.newBlock("core.flow.retry");
    expect(loop.getFieldValue("MAX_TURNS")).toBe("32");
    expect(loop.getFieldValue("OUTPUT_TOKENS")).toBe("32768");
    expect(loop.getInput("TOOLS")!.connection!.getCheck()).toEqual([
      "agent-tool",
    ]);
    expect(tool.previousConnection!.getCheck()).toEqual(["agent-tool"]);
    expect(repeat.getFieldValue("COUNT")).toBe("1");
    expect(foreach.getFieldValue("SOURCE")).toBe("result");
    expect(whileBlock.getFieldValue("OP")).toBe("truthy");
    expect(retry.getFieldValue("ATTEMPTS")).toBe("2");
    const condition = workspace.newBlock("core.logic.condition");
    const reply = workspace.newBlock("core.message.reply");
    repeat.getInput("DO")!.connection!.connect(reply.previousConnection!);
    expect(repeat.getInputTargetBlock("DO")).toBe(reply);
    reply.unplug();
    condition.getInput("ELSE")!.connection!.connect(reply.previousConnection!);
    expect(condition.getInputTargetBlock("ELSE")).toBe(reply);
  } finally {
    workspace.dispose();
  }
});
it("preserves editor group and note metadata through Blockly serialization", () => {
  registerBlocks();
  const source = createStarter().workspaces["research-agent"];
  editSelection(source, ["research-root"], {
    kind: "group",
    groupId: "group-study",
    label: "研究区域",
    region: true,
  });
  editSelection(source, ["research-root"], {
    kind: "annotate",
    note: "检查证据",
  });
  const workspace = new Blockly.Workspace();
  try {
    Blockly.serialization.workspaces.load(source, workspace);
    const saved = Blockly.serialization.workspaces.save(workspace) as Workspace;
    expect(saved.blocks.blocks[0].data).toEqual(source.blocks.blocks[0].data);
  } finally {
    workspace.dispose();
  }
});
it("preserves user blueprint instance metadata, edited role and answer style through actual Blockly save/reload", async () => {
    registerBlocks();
    const project = createStarter();
    const blueprint = await captureBlueprint(
      project,
      "research-agent",
      ["research-root"],
      "Blockly serialization scenario",
      "serialization-scenario",
    );
    const [original] = await instantiateBlueprint(
      blueprint,
      project,
      "research-agent",
      defaultBindings(blueprint),
      { x: 80, y: 70 },
      (sourceId) => `inserted-${sourceId}`,
    );
    const instance = blueprintInstance(original);
    expect(instance).toBeDefined();
    project.workspaces["research-agent"].blocks.blocks = [original];
    for (const [moduleId, source] of Object.entries(project.workspaces)) {
      const workspace = new Blockly.Workspace();
      const reloaded = new Blockly.Workspace();
      try {
        Blockly.serialization.workspaces.load(source, workspace);
        const count = workspace.getAllBlocks(false).length;
        if (moduleId === "research-agent") {
          workspace
            .getBlockById(original.id)!
            .setFieldValue("用户修改的角色", "ROLE");
          const answer = workspace.getBlockById("inserted-reply-answer");
          expect(answer!.getFieldValue("STYLE")).toBe("条目");
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
            reloaded.getBlockById(original.id)!.getFieldValue("ROLE"),
          ).toBe("用户修改的角色");
          const answer = reloaded.getBlockById("inserted-reply-answer")!;
          expect(answer.getFieldValue("STYLE")).toBe("条目");
          answer.setFieldValue("段落", "STYLE");
          const edited = JSON.parse(
            JSON.stringify(Blockly.serialization.workspaces.save(reloaded)),
          ) as Workspace;
          Blockly.serialization.workspaces.load(edited, workspace);
          expect(
            workspace
              .getBlockById("inserted-reply-answer")!
              .getFieldValue("STYLE"),
          ).toBe("段落");
          expect(
            (Blockly.serialization.workspaces.save(workspace) as Workspace)
              .blocks.blocks[0].extraState,
          ).toEqual(original.extraState);
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
});
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
it.each(["knowledge-ingestion", "knowledge-correction"])(
  "%s preserves edited ingestion and judgment fields through real Blockly save/reload",
  async (id) => {
    registerBlocks();
    const project = createCapabilityStarter(id, `ui-${id}`),
      source = project.workspaces["research-agent"];
    const workspace = new Blockly.Workspace(),
      reopened = new Blockly.Workspace();
    try {
      Blockly.serialization.workspaces.load(source, workspace);
      const target = workspace.getBlockById(
        id === "knowledge-ingestion" ? "ingest-chunk" : "check-evidence",
      )!;
      expect(target).toBeDefined();
      target.setFieldValue(
        id === "knowledge-ingestion" ? "320" : "2",
        id === "knowledge-ingestion" ? "SIZE" : "MAX_REWRITES",
      );
      if (id === "knowledge-correction")
        expect(target.getFieldValue("MODEL")).toBe("agent-model");
      const saved = JSON.parse(
        JSON.stringify(Blockly.serialization.workspaces.save(workspace)),
      ) as Workspace;
      Blockly.serialization.workspaces.load(saved, reopened);
      expect(
        reopened
          .getBlockById(target.id)!
          .getFieldValue(
            id === "knowledge-ingestion" ? "SIZE" : "MAX_REWRITES",
          ),
      ).toBe(id === "knowledge-ingestion" ? "320" : "2");
      project.workspaces["research-agent"] =
        Blockly.serialization.workspaces.save(reopened) as Workspace;
      expect((await compileProject(project)).diagnostics).toEqual([]);
    } finally {
      workspace.dispose();
      reopened.dispose();
    }
  },
);
