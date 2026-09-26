import {
  stableId,
  type Project,
  type WorkspaceBlock as Block,
} from "@blocky/language-schema";
import { projectShell } from "./shared";
import type { OfficialStarter } from "./index";

export const architectureStarters: OfficialStarter[] = [
  {
    id: "event-mailbox", displayName: "事件收件箱", description: "发送输入到当前会话的事件队列，再按顺序接收并处理。", sampleInput: "hello",
    steps: ["输入普通文本将其发送到 inbox。", "输入 next 接收最早一条消息，空队列返回 empty。", "发送与接收可放在不同模块中，共享同一项目的会话通道。"], version: 1,
  },
  {
    id: "state-machine",
    displayName: "有限状态机",
    description:
      "用状态、输入事件和条件完成待机→运行→完成；状态保留在当前会话。",
    sampleInput: "start",
    steps: [
      "输入 start 从 idle 转为 running。",
      "同一会话输入 finish 转为 done；终态忽略后续事件。",
      "修改状态转移条件和动作，观察轨迹中的记忆读写。",
    ],
    version: 1,
  },
  {
    id: "behavior-tree",
    displayName: "行为树",
    description:
      "展开查看 Sequence、Selector、条件和动作组合；失败选择后备，运行中保留状态。",
    sampleInput: "ready",
    steps: [
      "输入 ready 执行工作动作，返回 success。",
      "输入 busy 返回 running，不执行后备动作。",
      "其他输入执行 idle 后备；展开嵌套条件修改组合。",
    ],
    version: 1,
  },
  {
    id: "rule-engine",
    displayName: "优先级规则",
    description: "按优先级检查事实，执行首个匹配动作；同一输入只命中一条规则。",
    sampleInput: "urgent refund",
    steps: [
      "urgent 规则优先于 refund。",
      "修改条件和 ELSE 嵌套顺序，改变优先级。",
      "没有匹配时进入默认人工处理结果。",
    ],
    version: 1,
  },
  {
    id: "hybrid-router",
    displayName: "规则与模型协作",
    description: "已知问题直接返回规则结果，其余输入进入可配置模型步骤。",
    sampleInput: "status",
    steps: [
      "输入 status 走确定性规则，不执行模型。",
      "其他输入进入模型步骤；初始使用本地整理。",
      "可在资源中选择受控远程模型，仍遵守原有权限和证据护栏。",
    ],
    version: 1,
  },
];

/** Compositions of existing language atoms, not a second architecture runtime. */
export function createArchitectureStarter(
  id: string,
  projectId = `project-${crypto.randomUUID()}`,
): Project {
  const starter = architectureStarters.find((s) => s.id === id);
  if (!starter || !stableId.test(projectId)) throw Error("BLK-STARTER-001");
  const project = projectShell(projectId, starter.displayName);
  project.manifest.format.minimumReaderVersion = "0.5.0";
  const moduleId = "main";
  const purpose =
    id === "rule-engine" ? "rule" : ["hybrid-router", "event-mailbox"].includes(id) ? "general" : id;
  project.manifest.modules = [
    {
      moduleId,
      displayName: starter.displayName,
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
  if (id === "state-machine") {
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
          fields: { NAME: starter.displayName },
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
