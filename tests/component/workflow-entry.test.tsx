import { expect, it } from "vitest";
import { createStarter } from "../../packages/test-fixtures/src";
import { createArchitectureStarter } from "../../packages/test-fixtures/src/scenarios";
import { compileProject } from "../../packages/compiler/src";
import { findBlock } from "../../packages/project-model/src";
import { workflowEntry } from "../../apps/studio-desktop/src/composition/workflow-entry";
it.each(["agent-next", "standalone-handler"])(
  "finds the actual %s workflow entry and rejects mismatched scopes",
  async (kind) => {
    const project =
      kind === "agent-next"
        ? createStarter()
        : createArchitectureStarter("event-mailbox", "project-entry");
    const moduleId = kind === "agent-next" ? "research-agent" : "main";
    const entry =
      kind === "agent-next"
        ? findBlock(project.workspaces[moduleId].blocks.blocks, "on-question")!
        : project.workspaces[moduleId].blocks.blocks[0];
    const flow = {
      block: {
        id: "flow",
        type: "runtime.task.durable",
        inputs: {
          STEPS: {
            block: { id: "checkpoint", type: "runtime.checkpoint.save" },
          },
        },
      },
    };
    if (kind === "agent-next") entry.next = flow;
    else entry.inputs!.HANDLER = flow;
    const compiled = await compileProject(project);
    expect(compiled.diagnostics.filter((d) => d.severity === "error")).toEqual(
      [],
    );
    const task = {
      projectId: project.manifest.projectId,
      moduleId,
      blockId: "flow",
    };
    expect(workflowEntry(compiled, task)?.interactionId).toBe(entry.id);
    for (const wrong of [
      { ...task, projectId: "other" },
      { ...task, moduleId: "other" },
      { ...task, blockId: "other" },
    ])
      expect(workflowEntry(compiled, wrong)).toBeUndefined();
  },
);
