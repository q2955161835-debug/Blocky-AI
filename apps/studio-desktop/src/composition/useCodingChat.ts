import { agentMessageLimits } from "@blocky/language-schema";
import {
  codingTextBytePrefix,
  type CodingMessage,
} from "@blocky/builder-protocol";
import { useChatHistory } from "./useChatHistory";
export type { CodingMessage } from "@blocky/builder-protocol";
const encoder = new TextEncoder();
export function codingContext(messages: CodingMessage[]) {
  let context: { role: CodingMessage["role"]; text: string }[] = [];
  for (const { role, text, status } of messages.slice(-20).reverse()) {
    const message = {
      role,
      text:
        status && status !== "completed"
          ? codingTextBytePrefix(
              `[${status}] ${text}`,
              agentMessageLimits.outputBytes,
            )
          : text,
    };
    const candidate = [message, ...context];
    if (
      encoder.encode(JSON.stringify(candidate)).length <=
      agentMessageLimits.historyBytes
    )
      context = candidate;
    else break;
  }
  return context;
}
export function useCodingChat(
  projectId: string,
  report: (message: string) => void,
) {
  return useChatHistory(projectId, "builder", report);
}
