type SerializedBlock = {
  type: string;
  id: string;
  x?: number;
  y?: number;
  fields?: Record<string, string>;
  inputs?: Record<string, { block: SerializedBlock }>;
  next?: { block: SerializedBlock };
};

type WorkspaceState = {
  blocks: {
    languageVersion: number;
    blocks: SerializedBlock[];
  };
};

/** Counts `block`, input blocks, and next blocks in a Blockly workspace state. */
export function countSerializedBlocks(state: unknown): number {
  const visit = (value: unknown): number => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return 0;
    const record = value as Record<string, unknown>;
    const isBlock = typeof record.type === "string" && typeof record.id === "string";
    const inputs = record.inputs as Record<string, { block?: unknown }> | undefined;
    const inputCount = inputs
      ? Object.values(inputs).reduce((sum, connection) => sum + visit(connection.block), 0)
      : 0;
    const next = record.next as { block?: unknown } | undefined;
    return (isBlock ? 1 : 0) + inputCount + visit(next?.block);
  };

  const rootBlocks = (state as { blocks?: { blocks?: unknown } } | null)?.blocks?.blocks;
  return Array.isArray(rootBlocks) ? rootBlocks.reduce((sum, value) => sum + visit(value), 0) : 0;
}

export function createHundredBlockWorkspaceState(): WorkspaceState {
  let sequence = 1;
  const make = (
    type: string,
    options: Omit<SerializedBlock, "type" | "id"> = {},
  ): SerializedBlock => ({
    type,
    id: `block-${String(sequence++).padStart(3, "0")}`,
    ...options,
  });
  const input = (name: string, child: SerializedBlock) => ({ [name]: { block: child } });
  const append = (...blocks: SerializedBlock[]): SerializedBlock => {
    for (let index = 0; index < blocks.length - 1; index += 1) {
      blocks[index].next = { block: blocks[index + 1] };
    }
    return blocks[0];
  };
  const literal = (value: string) =>
    make("core.data.literal", { fields: { VALUE: value } });
  const message = (value: string) => {
    const created = make("core.message.create");
    created.inputs = input("CONTENT", literal(value));
    return created;
  };
  const reply = (value: string) => {
    const response = make("core.message.reply");
    response.inputs = input("MESSAGE", message(value));
    return response;
  };
  const eventReplyChain = (eventType: "core.event.manual_run" | "core.message.incoming", value: string) =>
    append(make(eventType), reply(value));

  const roots: SerializedBlock[] = [];

  const agent = make("core.agent.define", { x: 24, y: 24, fields: { NAME: "Weather assistant" } });
  const firstEntry = make("core.interaction.chat_entry", { fields: { NAME: "Chat" } });
  firstEntry.inputs = {
    ...input(
      "CAPABILITIES",
      append(
        make("core.interaction.accept_text"),
        make("core.interaction.accept_image"),
        make("core.interaction.accept_file"),
        make("core.interaction.accept_voice"),
        make("core.interaction.expose_skill", { fields: { SKILL: "forecast" } }),
        make("core.interaction.expose_plugin", { fields: { PLUGIN: "weather" } }),
      ),
    ),
    ...input("HANDLER", append(reply("Hello"), make("core.message.send"), make("core.message.stream"), make("core.message.wait"))),
  };
  const secondEntry = make("core.interaction.chat_entry", { fields: { NAME: "Follow-up" } });
  secondEntry.inputs = {
    ...input("CAPABILITIES", make("core.interaction.expose_skill", { fields: { SKILL: "history" } })),
    ...input("HANDLER", reply("How can I help?")),
  };
  const addTool = make("core.agent.add_tool");
  addTool.inputs = input("TOOL", make("core.tool.reference", { fields: { TOOL_ID: "tool.weather" } }));
  agent.inputs = input("MEMBERS", append(firstEntry, secondEntry, addTool));
  roots.push(agent);

  const tool = make("core.tool.define", { x: 460, y: 24, fields: { TOOL_ID: "tool.weather" } });
  tool.inputs = input(
    "CONTRACT",
    append(
      make("core.tool.parameter", { fields: { NAME: "city" } }),
      make("core.tool.result_schema"),
      make("core.tool.require_approval"),
    ),
  );
  roots.push(tool);

  roots.push(eventReplyChain("core.event.manual_run", "Manual hello"));
  roots.push(eventReplyChain("core.message.incoming", "Incoming hello"));

  const conditional = make("core.flow.if", { x: 24, y: 300 });
  const comparison = make("core.data.compare");
  const record = make("core.data.record");
  record.inputs = input("VALUE", literal("right"));
  comparison.inputs = { ...input("LEFT", literal("left")), ...input("RIGHT", record) };
  conditional.inputs = {
    ...input("CONDITION", comparison),
    ...input("DO", append(reply("Condition met"), make("core.message.wait"))),
  };
  roots.push(conditional);

  const toolCall = make("core.tool.call", { x: 460, y: 300 });
  toolCall.inputs = input("TOOL", make("core.tool.reference", { fields: { TOOL_ID: "tool.weather" } }));
  roots.push(toolCall, make("core.tool.result"));

  const field = make("core.message.field");
  field.inputs = input("MESSAGE", message("field source"));
  roots.push(field);
  const addPart = make("core.message.add_part");
  addPart.inputs = input("PART", literal("part"));
  roots.push(append(addPart, make("core.message.send"), make("core.message.stream")));
  roots.push(make("core.interaction.current_entry"), make("core.interaction.reference", { fields: { ENTRY_ID: "Chat" } }));

  let chainNumber = 1;
  const state = (): WorkspaceState => ({ blocks: { languageVersion: 0, blocks: roots } });
  while (countSerializedBlocks(state()) <= 96) {
    roots.push(
      eventReplyChain(
        chainNumber % 2 === 0 ? "core.message.incoming" : "core.event.manual_run",
        `Deterministic reply ${chainNumber}`,
      ),
    );
    chainNumber += 1;
  }
  while (countSerializedBlocks(state()) < 100) roots.push(literal(`padding ${chainNumber++}`));

  roots.forEach((root, index) => {
    root.x = 24 + (index % 4) * 520;
    // Keep fixture roots clear of the fixed canvas badge and project actions.
    root.y = 96 + Math.floor(index / 4) * 640;
  });

  const result = state();
  const count = countSerializedBlocks(result);
  if (count !== 100 || sequence !== 101) {
    throw new Error(`Expected a stable 100-block fixture, received ${count} blocks.`);
  }
  return result;
}
