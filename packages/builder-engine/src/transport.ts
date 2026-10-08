import type { Message } from "@earendil-works/pi-ai";

export type WireMessage = {
  role: string;
  content: string | null;
  reasoning_content?: string;
  tool_calls?: {
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }[];
  tool_call_id?: string;
};
export type BuilderGeneration = {
  schemaVersion?: "blocky.model-response/v2";
  usageStatus?: "reported" | "unavailable";
  localInference?: boolean;
  externalApi?: boolean;
  content: {
    type: string;
    text?: string;
    thinking?: string;
    id?: string;
    name?: string;
    arguments?: unknown;
  }[];
  provider: string;
  model: string;
  requestId: string;
  transport: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  } | null;
};
export function wireMessages(messages: Message[]): WireMessage[] {
  return messages.map((message) => {
    if (message.role === "system")
      return {
        role: "system",
        content: [
          typeof message.content === "string"
            ? message.content
            : message.content.map((c) => c.text).join("\n"),
          ...Object.values(message.sections ?? {}).filter(Boolean),
        ].join("\n"),
      };
    if (message.role === "user")
      return {
        role: "user",
        content:
          typeof message.content === "string"
            ? message.content
            : message.content
                .filter((c) => c.type === "text")
                .map((c) => c.text)
                .join("\n"),
      };
    if (message.role === "toolResult")
      return {
        role: "tool",
        tool_call_id: message.toolCallId,
        content: message.content
          .filter((c) => c.type === "text")
          .map((c) => c.text)
          .join("\n"),
      };
    const calls = message.content.flatMap((c) =>
      c.type === "toolCall"
        ? [
            {
              id: c.id,
              type: "function" as const,
              function: {
                name: c.name,
                arguments: JSON.stringify(c.arguments),
              },
            },
          ]
        : [],
    );
    const content = message.content
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("\n");
    return {
      role: "assistant",
      content: content || null,
      reasoning_content: message.content.filter((c) => c.type === "thinking").map((c) => c.thinking).join(""),
      ...(calls.length ? { tool_calls: calls } : {}),
    };
  });
}
export function safeBuilderError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /^(BLK-(?:BUILDER|PROVIDER|MODEL|LOCAL-MODEL|PATCH|SURFACE|PERM|APPROVAL)[A-Z0-9-]*)$/.test(
    message,
  )
    ? message
    : "BLK-BUILDER-ENGINE";
}
