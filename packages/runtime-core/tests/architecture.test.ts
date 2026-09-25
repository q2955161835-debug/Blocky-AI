import { expect, it } from "vitest";
import { createStarter } from "../../test-fixtures/src";
import { compileProject } from "@blocky/compiler";
import { Runtime } from "../src";
import {
  createArchitectureStarter,
  architectureStarters,
} from "../../block-catalog/src";

it.each(architectureStarters)(
  "compiles $id as an independent module",
  async (starter) => {
    const p = createArchitectureStarter(starter.id);
    expect(
      p.workspaces.main.blocks.blocks.some((b) =>
        b.type.startsWith("core.agent"),
      ),
    ).toBe(false);
    expect(
      (await compileProject(p)).diagnostics.filter(
        (d) => d.severity === "error",
      ),
    ).toEqual([]);
  },
);
it("retains state transitions within one session, respects terminal state and isolates projects", async () => {
  const runtime = new Runtime(),
    project = createArchitectureStarter("state-machine");
  for (const [input, expected] of [
    ["unknown", "idle"],
    ["start", "running"],
    ["start", "running"],
    ["finish", "done"],
    ["start", "done"],
  ]) {
    const run = await runtime.run(project, "on-event", input);
    expect(run.status).toBe("completed");
    expect(run.structured).toBe(expected);
  }
  expect(
    (
      await runtime.run(
        createArchitectureStarter("state-machine"),
        "on-event",
        "finish",
      )
    ).structured,
  ).toBe("idle");
  expect(
    (await new Runtime().run(project, "on-event", "finish")).structured,
  ).toBe("idle");
});
it.each([
  ["ready", "success", "work"],
  ["busy", "running", "waiting"],
  ["unknown", "success", "idle"],
])(
  "ticks behavior tree for %s with correct short circuits",
  async (input, status, action) => {
    const run = await new Runtime().run(
      createArchitectureStarter("behavior-tree"),
      "on-event",
      input,
    );
    expect(run.status).toBe("completed");
    expect(run.structured).toBe(status);
    expect(
      run.events
        .filter(
          (e) => e.type === "block.started" && e.blockId?.startsWith("action-"),
        )
        .map((e) => e.blockId),
    ).toEqual([`action-${action}`]);
  },
);
it("applies first-match priority and calls the model only on the hybrid fallback", async () => {
  const runtime = new Runtime();
  for (const [input, output] of [
    ["urgent refund", "priority-support"],
    ["refund", "refund-review"],
    ["other", "manual-review"],
  ])
    expect(
      (
        await runtime.run(
          createArchitectureStarter("rule-engine"),
          "on-event",
          input,
        )
      ).structured,
    ).toBe(output);
  const project = createArchitectureStarter("hybrid-router");
  const direct = await runtime.run(project, "on-event", "status");
  expect(direct.structured).toBe("ready");
  expect(direct.events.some((e) => e.type === "model.started")).toBe(false);
  const fallback = await runtime.run(project, "on-event", "custom question");
  expect(fallback.status).toBe("completed");
  expect(fallback.events.some((e) => e.type === "model.completed")).toBe(true);
  expect(fallback.modelApiCalled).toBe(false);
});

it("allows the shared statement language at an independent module entry", async () => {
  const project = createStarter();
  project.manifest.modules = [
    {
      moduleId: "rules",
      displayName: "规则",
      purpose: "rule",
      workspaceRef: "workspaces/rules.workspace.json",
      exports: [],
    },
  ];
  project.workspaces = {
    rules: {
      blocks: {
        languageVersion: 0,
        blocks: [
          {
            type: "core.interaction.chat_entry",
            id: "on-event",
            fields: { NAME: "规则输入" },
            inputs: {
              CAPABILITIES: {
                block: {
                  type: "core.interaction.accept_text",
                  id: "accept-text",
                },
              },
              HANDLER: {
                block: {
                  type: "core.data.set",
                  id: "result",
                  fields: { VALUE: '"accepted"' },
                  next: {
                    block: {
                      type: "core.output.structured",
                      id: "output",
                      fields: { SCHEMA: "schemas/result.json" },
                    },
                  },
                },
              },
            },
          },
        ],
      },
    },
  };
  project.schemas["schemas/result.json"] = { type: "string" };
  expect(
    (await compileProject(project)).diagnostics.filter(
      (d) => d.severity === "error",
    ),
  ).toEqual([]);
  expect(
    (await new Runtime().run(project, "on-event", "hello")).structured,
  ).toBe("accepted");
});
