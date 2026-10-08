import { stableId, agentMessageLimits } from "@blocky/language-schema";
import {
  codingChatStateSchema,
  type CodingMessage,
} from "@blocky/builder-protocol";

export type ChatAssistant = "agent" | "builder";
export type ChatThread = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};
export type ChatIndex = {
  schemaVersion: "blocky.chat-index/v1";
  projectId: string;
  assistant: ChatAssistant;
  activeId: string;
  threads: ChatThread[];
};
export type ChatConversation = {
  schemaVersion: "blocky.chat-conversation/v1";
  projectId: string;
  assistant: ChatAssistant;
  thread: ChatThread;
  messages: CodingMessage[];
};
const fail = () => Error("BLK-CHAT-HISTORY");
const encoder = new TextEncoder();
function keys(
  value: unknown,
  allowed: string[],
): asserts value is Record<string, any> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !allowed.includes(key)) ||
    allowed.some((key) => !Object.hasOwn(value, key))
  )
    throw fail();
}
function identity(value: unknown): value is string {
  return (
    typeof value === "string" && value.length <= 128 && stableId.test(value)
  );
}
function thread(value: unknown): ChatThread {
  keys(value, ["id", "title", "createdAt", "updatedAt"]);
  if (
    !identity(value.id) ||
    typeof value.title !== "string" ||
    !value.title.trim() ||
    value.title.length > 180 ||
    ![value.createdAt, value.updatedAt].every(
      (date) =>
        typeof date === "string" &&
        /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(date) &&
        Number.isFinite(Date.parse(date)),
    )
  )
    throw fail();
  return value as ChatThread;
}
export function parseChatIndex(
  raw: unknown,
  projectId: string,
  assistant: ChatAssistant,
): ChatIndex {
  keys(raw, ["schemaVersion", "projectId", "assistant", "activeId", "threads"]);
  if (
    raw.schemaVersion !== "blocky.chat-index/v1" ||
    raw.projectId !== projectId ||
    raw.assistant !== assistant ||
    !Array.isArray(raw.threads) ||
    !raw.threads.length ||
    raw.threads.length > 1000
  )
    throw fail();
  const threads = raw.threads.map(thread);
  if (
    new Set(threads.map((t) => t.id)).size !== threads.length ||
    !threads.some((t) => t.id === raw.activeId)
  )
    throw fail();
  return { ...raw, threads } as ChatIndex;
}
export function parseChatConversation(
  raw: unknown,
  projectId: string,
  assistant: ChatAssistant,
  id: string,
): ChatConversation {
  keys(raw, ["schemaVersion", "projectId", "assistant", "thread", "messages"]);
  if (
    raw.schemaVersion !== "blocky.chat-conversation/v1" ||
    raw.projectId !== projectId ||
    raw.assistant !== assistant ||
    thread(raw.thread).id !== id
  )
    throw fail();
  const messages = codingChatStateSchema.parse({
    schemaVersion: "blocky.coding-chat/v1",
    projectId,
    messages: raw.messages,
  }).messages;
  if (new Set(messages.map((m) => m.id)).size !== messages.length) throw fail();
  return {
    ...raw,
    messages: messages.map((m) =>
      m.status === "proposed" ? { ...m, status: "stale" as const } : m,
    ),
  } as ChatConversation;
}
export function boundedChatMessages(
  messages: CodingMessage[],
): CodingMessage[] {
  let retained: CodingMessage[] = [];
  for (const message of messages.slice(-40).reverse()) {
    const next = [message, ...retained];
    if (
      encoder.encode(JSON.stringify(next)).length >
      agentMessageLimits.historyBytes
    )
      break;
    retained = next;
  }
  return retained;
}
export function makeChatConversation(
  projectId: string,
  assistant: ChatAssistant,
  messages: CodingMessage[] = [],
): ChatConversation {
  const date = new Date().toISOString();
  return {
    schemaVersion: "blocky.chat-conversation/v1",
    projectId,
    assistant,
    thread: {
      id: `chat-${crypto.randomUUID()}`,
      title: chatTitle(messages),
      createdAt: date,
      updatedAt: date,
    },
    messages: boundedChatMessages(messages),
  };
}
export function chatTitle(messages: CodingMessage[]) {
  return (
    messages
      .find((m) => m.role === "user")
      ?.text.trim()
      .replace(/\s+/g, " ")
      .slice(0, 80) || "新会话"
  );
}
export const chatIndexKind = (assistant: ChatAssistant) =>
  `chat-history-${assistant}`;
