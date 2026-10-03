import {
  stableId,
  type Project,
  type WorkspaceBlock as Block,
} from "@blocky/language-schema";
import { projectShell } from "./shared";
import { durableWorkflowBody } from "./durable-workflow";

/** Builds architecture-shaped test projects without registering product templates. */
export function createArchitectureStarter(
  id: string,
  projectId = `project-${crypto.randomUUID()}`,
): Project {
  const supported = new Set([
    "durable-workflow",
    "event-mailbox",
    "state-machine",
    "behavior-tree",
    "rule-engine",
    "hybrid-router",
  ]);
  if (!supported.has(id) || !stableId.test(projectId))
    throw Error("BLK-STARTER-001");
  const displayName = `test scenario: ${id}`;
  const project = projectShell(projectId, displayName);
  project.manifest.format.minimumReaderVersion = "0.5.0";
  const moduleId = "main";
  const purpose =
    id === "durable-workflow" ? "automation" : id === "rule-engine" ? "rule" : ["hybrid-router", "event-mailbox"].includes(id) ? "general" : id;
  project.manifest.modules = [
    {
      moduleId,
      displayName,
      purpose,
      workspaceRef: "workspaces/main.workspace.json",
      exports: [],
    },
  ];
  let serial = 0;
  const block = (
    type: string,
    fields: Record<string, string> = {},
    inputs: Record<string, { block: Block }> = {},
  ): Block => ({
    type,
    id: `step-${++serial}`,
    fields,
    ...(Object.keys(inputs).length ? { inputs } : {}),
  });
  const stack = (...items: Block[]) => {
    items.forEach((item, i) => {
      if (!items[i + 1]) return;
      let tail = item;
      while (tail.next) tail = tail.next.block;
      tail.next = { block: items[i + 1] };
    });
    return items[0];
  };
  const value = (text: string) =>
    block("core.data.set", { VALUE: JSON.stringify(text) });
  const read = (key: string) =>
    block("core.memory.read", { SCOPE: "session", KEY: key });
  const write = (key: string, source = "result") =>
    block("core.memory.write", { SCOPE: "session", KEY: key, SOURCE: source });
  const condition = (
    source: string,
    op: string,
    match: string,
    yes: Block,
    no?: Block,
  ) =>
    block(
      "core.logic.condition",
      { SOURCE: source, OP: op, VALUE: match },
      { THEN: { block: yes }, ...(no ? { ELSE: { block: no } } : {}) },
    );
  const output = () =>
    block("core.output.structured", { SCHEMA: "schemas/result.json" });
  let body: Block;
  if (id === "durable-workflow") {
    body = durableWorkflowBody();
  } else if (id === "state-machine") {
    const transition = (event: string, from: string, to: string) =>
      condition(
        "input",
        "equals",
        event,
        condition(
          "memory",
          "equals",
          from,
          stack(value(to), write("machine-state")),
        ),
      );
    body = stack(
      read("machine-state"),
      condition(
        "memory",
        "truthy",
        "",
        value("unchanged"),
        stack(value("idle"), write("machine-state")),
      ),
      transition("start", "idle", "running"),
      transition("finish", "running", "done"),
      read("machine-state"),
      output(),
    );
  } else if (id === "behavior-tree") {
    const test = (input: string) =>
      condition("input", "equals", input, value("success"), value("failure"));
    const action = (name: string, status = "success") => {
      const node = write(`action-${name}`, "input");
      node.id = `action-${name}`;
      return stack(node, value(status));
    };
    const sequence = (first: Block, second: Block) =>
      stack(first, condition("result", "equals", "success", second));
    const selector = (first: Block, fallback: Block) =>
      stack(first, condition("result", "equals", "failure", fallback));
    // Each composite is an ordinary conditional chain; running is neither success nor failure.
    body = stack(
      selector(
        sequence(test("ready"), action("work")),
        selector(
          sequence(test("busy"), action("waiting", "running")),
          action("idle"),
        ),
      ),
      output(),
    );
  } else if (id === "rule-engine") {
    body = stack(
      condition(
        "input",
        "contains",
        "urgent",
        value("priority-support"),
        condition(
          "input",
          "contains",
          "refund",
          value("refund-review"),
          value("manual-review"),
        ),
      ),
      output(),
    );
  } else if (id === "event-mailbox") {
    body = stack(condition("input", "equals", "next",
      block("core.event.receive", { CHANNEL: "inbox", TIMEOUT_MS: "0" }, { EMPTY: { block: value("empty") } }),
      stack(block("core.event.send", { CHANNEL: "inbox", SOURCE: "input" }), value("queued"))), output());
  } else {
    const resourceId = "router-model";
    project.resources[resourceId] = {
      schemaVersion: "blocky.resource/v1alpha1",
      resourceId,
      kind: "model",
      scope: "project",
      displayName: "整理模型",
      definition: {
        provider: "deterministic",
        modelId: "generator-v1",
        protocol: "local",
        timeoutMs: 30000,
        capabilities: ["text"],
        parameters: { maxOutputTokens: 1024 },
        implementationRef: { kind: "adapter", id: "generator-v1" },
      },
      capabilityRequirements: [],
      secretBindings: [],
    };
    project.manifest.resources = [
      {
        resourceId,
        kind: "model",
        scope: "project",
        definitionRef: `resources/${resourceId}.json`,
        secretRefs: [],
      },
    ];
    body = stack(
      condition(
        "input",
        "equals",
        "status",
        value("ready"),
        stack(
          block("core.prompt.context", {
            TEXT: "说明当前输入，无法核实的内容明确标注。",
          }),
          write("current-request", "input"),
          read("current-request"),
          block("core.model.compose", { RESOURCE: resourceId }),
        ),
      ),
      output(),
    );
  }
  project.schemas["schemas/result.json"] = { type: "string" };
  project.workspaces[moduleId] = {
    blocks: {
      languageVersion: 0,
      blocks: [
        {
          type: "core.interaction.chat_entry",
          id: "on-event",
          x: 80,
          y: 70,
          fields: { NAME: displayName },
          inputs: {
            CAPABILITIES: {
              block: {
                type: "core.interaction.accept_text",
                id: "accept-text",
              },
            },
            HANDLER: { block: body },
          },
        },
      ],
    },
  };
  return project;
}
