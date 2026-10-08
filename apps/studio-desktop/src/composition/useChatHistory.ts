import { useEffect, useRef, useState } from "react";
import {
  codingChatStateSchema,
  codingMessageSchema,
  type CodingMessage,
} from "@blocky/builder-protocol";
import { readUserState, writeUserState } from "./userState";
import {
  boundedChatMessages,
  chatIndexKind,
  chatTitle,
  makeChatConversation,
  parseChatConversation,
  parseChatIndex,
  type ChatAssistant,
  type ChatConversation,
  type ChatIndex,
} from "./chatHistory";

/** Indexed text-only conversations. A failed index write never replaces the selected conversation. */
export function useChatHistory(
  projectId: string,
  assistant: ChatAssistant,
  report: (message: string) => void,
) {
  const scope = `${assistant}:${projectId}`;
  const current = useRef(scope);
  current.current = scope;
  const state = useRef<
    | { scope: string; index: ChatIndex; conversation: ChatConversation }
    | undefined
  >(undefined);
  const queue = useRef(Promise.resolve());
  const reads = useRef(
    new Map<
      string,
      Promise<{
        scope: string;
        index: ChatIndex;
        conversation: ChatConversation;
      }>
    >(),
  );
  const loading = useRef(false),
    mounted = useRef(true),
    reporter = useRef(report);
  reporter.current = report;
  const [loaded, setLoaded] = useState("");
  const [, refresh] = useState(0);
  const [switching, setSwitching] = useState(false);
  const notify = () => {
    if (mounted.current)
      reporter.current("会话未能保存或读取，请检查后重试；原会话仍保留。");
  };
  const save = async (index: ChatIndex, conversation: ChatConversation) => {
    await writeUserState(
      "chat-conversation",
      conversation.thread.id,
      conversation,
    );
    await writeUserState(
      chatIndexKind(index.assistant),
      index.projectId,
      index,
    );
  };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    setLoaded("");
    const load = async () => {
      await queue.current.catch(() => {});
      const raw = await readUserState(chatIndexKind(assistant), projectId);
      let index: ChatIndex, conversation: ChatConversation;
      if (raw !== null) {
        index = parseChatIndex(raw, projectId, assistant);
        conversation = parseChatConversation(
          await readUserState("chat-conversation", index.activeId),
          projectId,
          assistant,
          index.activeId,
        );
      } else {
        const legacy =
          assistant === "builder"
            ? await readUserState("coding-chat", projectId)
            : null;
        let messages: CodingMessage[] = [];
        if (legacy !== null) {
          const parsed = codingChatStateSchema.parse(legacy);
          if (parsed.projectId !== projectId) throw Error();
          messages = parsed.messages.map((m) =>
            m.status === "proposed" ? { ...m, status: "stale" as const } : m,
          );
        }
        conversation = makeChatConversation(projectId, assistant, messages);
        index = {
          schemaVersion: "blocky.chat-index/v1",
          projectId,
          assistant,
          activeId: conversation.thread.id,
          threads: [conversation.thread],
        };
        // Freeze migration before exposing mutations. Existing v1 remains untouched.
        if (messages.length) {
          queue.current = queue.current
            .catch(() => {})
            .then(() => save(index, conversation));
          await queue.current;
        }
      }
      return { scope, index, conversation };
    };
    let pending = reads.current.get(scope);
    if (!pending) {
      pending = load();
      reads.current.set(scope, pending);
      void pending
        .finally(() => {
          reads.current.delete(scope);
        })
        .catch(() => {});
    }
    void pending
      .then((value) => {
        if (active && current.current === scope) {
          state.current = value;
          setLoaded(scope);
          refresh((n) => n + 1);
        }
      })
      .catch(() => {
        if (active) notify();
      });
    return () => {
      active = false;
    };
  }, [scope]);
  const update = (
    id: string,
    fn: (messages: CodingMessage[]) => CodingMessage[],
  ) => {
    const previous = state.current;
    if (
      !previous ||
      previous.scope !== current.current ||
      previous.index.projectId !== id ||
      loading.current
    )
      return;
    const messages = boundedChatMessages(
      fn(previous.conversation.messages),
    ).map((m) => codingMessageSchema.parse(m));
    const conversation = {
      ...previous.conversation,
      messages,
      thread: {
        ...previous.conversation.thread,
        title: previous.conversation.messages.some(
          (message) => message.role === "user",
        )
          ? previous.conversation.thread.title
          : chatTitle(messages),
        updatedAt: new Date().toISOString(),
      },
    };
    const index = {
      ...previous.index,
      threads: previous.index.threads.map((t) =>
        t.id === conversation.thread.id ? conversation.thread : t,
      ),
    };
    state.current = { scope: previous.scope, index, conversation };
    if (mounted.current) refresh((n) => n + 1);
    queue.current = queue.current
      .catch(() => {})
      .then(async () => {
        await save(index, conversation);
        // Keep the CLI's current v1 text contract. Archives and index are authoritative for the GUI.
        if (assistant === "builder")
          await writeUserState("coding-chat", id, {
            schemaVersion: "blocky.coding-chat/v1",
            projectId: id,
            messages: messages.map(({ id, role, text, status }) => ({
              id,
              role,
              text,
              ...(status ? { status } : {}),
            })),
          });
      });
    void queue.current.catch(notify);
  };
  const change = async (target?: string) => {
    const previous = state.current;
    if (
      !previous ||
      previous.scope !== scope ||
      loaded !== scope ||
      loading.current
    )
      return false;
    if (target === previous.index.activeId) return true;
    if (target && !previous.index.threads.some((t) => t.id === target))
      return false;
    if (!target && previous.index.threads.length >= 1000) {
      notify();
      return false;
    }
    loading.current = true;
    setSwitching(true);
    try {
      const work = queue.current
        .catch(() => {})
        .then(async () => {
          const conversation = target
            ? parseChatConversation(
                await readUserState("chat-conversation", target),
                projectId,
                assistant,
                target,
              )
            : makeChatConversation(projectId, assistant);
          const index = {
            ...previous.index,
            activeId: conversation.thread.id,
            threads: target
              ? previous.index.threads
              : [...previous.index.threads, conversation.thread],
          };
          await save(previous.index, previous.conversation);
          await save(index, conversation);
          return { index, conversation };
        });
      queue.current = work.then(() => {});
      void queue.current.catch(() => {});
      const { index, conversation } = await work;
      if (current.current !== scope || !mounted.current) return false;
      state.current = { scope, index, conversation };
      refresh((n) => n + 1);
      return true;
    } catch {
      notify();
      return false;
    } finally {
      loading.current = false;
      if (mounted.current) setSwitching(false);
    }
  };
  const value = state.current?.scope === scope ? state.current : undefined;
  return {
    ready: loaded === scope,
    switching,
    activeId: value?.index.activeId ?? "",
    threads: value?.index.threads ?? [],
    messages: value?.conversation.messages ?? [],
    update,
    newChat: () => change(),
    select: (id: string) => change(id),
    flush: async () => {
      await Promise.allSettled([...reads.current.values()]);
      await queue.current;
    },
  };
}
