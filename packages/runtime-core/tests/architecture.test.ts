import { expect, it } from "vitest";
import { createStarter } from "../../test-fixtures/src";
import { createArchitectureStarter } from "../../test-fixtures/src/scenarios";
import { compileProject } from "@blocky/compiler";
import { Runtime } from "../src";

it("runs an event mailbox across inputs without leaking payloads to trace events", async () => {
  const runtime = new Runtime(), project = createArchitectureStarter("event-mailbox");
  for (const [input, expected] of [["private-message-abc", "queued"], ["second", "queued"], ["next", "private-message-abc"], ["next", "second"], ["next", "empty"]]) {
    const result = await runtime.run(project, "on-event", input);
    expect(result.status).toBe("completed");
    expect(result.structured).toBe(expected);
    expect(JSON.stringify(result.events)).not.toContain("private-message-abc");
  }
  expect((await new Runtime().run(project, "on-event", "next")).structured).toBe("empty");
});

it("shares a project mailbox across modules and rejects invalid wait parameters before running", async () => {
  const project = createArchitectureStarter("event-mailbox"), runtime = new Runtime();
  project.manifest.modules.push({ ...project.manifest.modules[0], moduleId: "consumer", workspaceRef: "workspaces/consumer.workspace.json" });
  project.workspaces.consumer = structuredClone(project.workspaces.main);
  expect((await runtime.run(project, "on-event", "message", { moduleId: "main" })).structured).toBe("queued");
  expect((await runtime.run(project, "on-event", "next", { moduleId: "consumer" })).structured).toBe("message");
  const handler = project.workspaces.main.blocks.blocks[0].inputs!.HANDLER!.block!;
  handler.inputs!.THEN!.block!.fields!.TIMEOUT_MS = "30001";
  expect((await compileProject(project)).diagnostics.some(d => d.code === "BLK-EVENT-001")).toBe(true);
  const failed = await runtime.run(project, "on-event", "next", { moduleId: "main" });
  expect(failed.status).toBe("failed");
  expect(failed.events.some(e => e.type === "block.started")).toBe(false);
});

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
