import type { WorkspaceBlock as Block } from "@blocky/language-schema";

/** Ordinary editable steps, executed by the shared durable Runtime. */
export function durableWorkflowBody(): Block {
  const block = (
    id: string,
    type: string,
    fields: Record<string, string> = {},
    inputs: Record<string, { block: Block }> = {},
  ): Block => ({ id, type, fields, inputs });
  const stack = (...items: Block[]) => {
    for (let i = 0; i < items.length - 1; i++)
      items[i].next = { block: items[i + 1] };
    return items[0];
  };
  const output = (id: string) =>
    block(id, "core.output.structured", { SCHEMA: "schemas/result.json" });
  return block(
    "workflow",
    "runtime.task.durable",
    {},
    {
      STEPS: {
        block: stack(
          block(
            "prepare",
            "runtime.compensate",
            {},
            {
              DO: {
                block: block("remember", "core.memory.write", {
                  SCOPE: "session",
                  KEY: "saved-input",
                  SOURCE: "input",
                }),
              },
              UNDO: {
                block: stack(
                  block("clear-prepared", "core.memory.delete", {
                    SCOPE: "session",
                    KEY: "saved-input",
                  }),
                  block("undo-value", "core.data.set", {
                    VALUE: '"compensated"',
                  }),
                  output("undo-output"),
                ),
              },
            },
          ),
          block("approve", "core.human.approve", {
            LABEL: "是否交付本次保存的输入？",
          }),
          block(
            "deliver",
            "runtime.compensate",
            {},
            {
              DO: {
                block: stack(
                  block("recall", "core.memory.read", {
                    SCOPE: "session",
                    KEY: "saved-input",
                  }),
                  output("deliver-output"),
                ),
              },
            },
          ),
          block("checkpoint", "runtime.checkpoint.save"),
        ),
      },
    },
  );
}
