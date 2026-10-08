import { useEffect, useRef, useState } from "react";
import {
  builderInputBudget,
  builderConversationSchema,
} from "@blocky/builder-protocol";
import { readUserState, writeUserState } from "./userState";

export type BuilderChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  status?:
    | "proposed"
    | "accepted"
    | "rejected"
    | "explained"
    | "failed"
    | "cancelled"
    | "stale";
};
const version = "blocky.builder-chat/v1";
function bounded(messages: BuilderChatMessage[]) {
  let size = 0,
    bytes = 0;
  return messages
    .slice(-40)
    .reverse()
    .filter((message) => {
      size += message.text.length;
      bytes += new TextEncoder().encode(message.text).length;
      return size <= 64000 && bytes <= 100000;
    })
    .reverse();
}
function restore(raw: unknown, projectId: string): BuilderChatMessage[] {
  if (raw == null) return [];
  builderInputBudget(raw);
  const value = raw as {
    schemaVersion?: string;
    projectId?: string;
    messages?: unknown[];
  };
  if (
    value.schemaVersion !== version ||
    value.projectId !== projectId ||
    !Array.isArray(value.messages) ||
    value.messages.length > 40
  )
    throw Error("BLK-BUILDER-CHAT");
  const ids = new Set<string>();
  return bounded(
    value.messages.map((raw) => {
      const { id, ...message } = raw as BuilderChatMessage;
      if (
        typeof id !== "string" ||
        !/^[a-zA-Z0-9_-]{1,200}$/.test(id) ||
        ids.has(id)
      )
        throw Error("BLK-BUILDER-CHAT");
      ids.add(id);
      const parsed = builderConversationSchema.parse([message])[0];
      return {
        id,
        ...parsed,
        ...(parsed.status === "proposed" ? { status: "stale" as const } : {}),
      };
    }),
  );
}
export function conversationContext(messages: BuilderChatMessage[]) {
  let size = 0;
  return messages
    .slice(-20)
    .reverse()
    .filter((message) => {
      size += message.text.length;
      return size <= 32000;
    })
    .reverse()
    .map(({ id: _id, ...message }) => message);
}

/** The chat is user state; proposals and project edits are never persisted here. */
export function useBuilderChat(
  projectId: string,
  report: (message: string) => void,
) {
  const current = useRef(projectId);
  current.current = projectId;
  const cache = useRef(new Map<string, BuilderChatMessage[]>());
  const touched = useRef(new Set<string>());
  const dirty = useRef(new Set<string>());
  const queue = useRef(Promise.resolve());
  const alive = useRef(true);
  const [loaded, setLoaded] = useState("");
  const [, refresh] = useState(0);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    if (cache.current.has(projectId)) {
      setLoaded(projectId);
      return;
    }
    void readUserState("builder-chat", projectId)
      .then((raw) => {
        const messages = restore(raw, projectId);
        if (!touched.current.has(projectId))
          cache.current.set(projectId, messages);
        if (active) {
          setLoaded(projectId);
          refresh((n) => n + 1);
        }
      })
      .catch(() => {
        if (active) {
          report("本机对话无法读取，已保留原文件；可以开始新对话。");
          setLoaded(projectId);
        }
      });
    return () => {
      active = false;
    };
  }, [projectId]);
  const update = (
    id: string,
    fn: (messages: BuilderChatMessage[]) => BuilderChatMessage[],
  ) => {
    const messages = bounded(fn(cache.current.get(id) ?? []));
    const value = { schemaVersion: version, projectId: id, messages };
    builderInputBudget(value);
    touched.current.add(id);
    dirty.current.add(id);
    cache.current.set(id, messages);
    if (alive.current && current.current === id) refresh((n) => n + 1);
    queue.current = queue.current
      .catch(() => {})
      .then(async () => {
        await writeUserState("builder-chat", id, value);
        if (cache.current.get(id) === messages) dirty.current.delete(id);
      });
    void queue.current.catch(() => {
      if (alive.current) report("本机对话未能保存，请检查可用空间。");
    });
  };
  return {
    messages: cache.current.get(projectId) ?? [],
    ready: loaded === projectId,
    update,
    flush: async () => {
      await queue.current.catch(() => {});
      while (dirty.current.size) {
        for (const id of [...dirty.current]) {
          const messages = cache.current.get(id)!;
          const value = { schemaVersion: version, projectId: id, messages };
          builderInputBudget(value);
          queue.current = queue.current.catch(() => {}).then(async () => {
            if (dirty.current.has(id) && cache.current.get(id) === messages) {
              await writeUserState("builder-chat", id, value);
              if (cache.current.get(id) === messages) dirty.current.delete(id);
            }
          });
          await queue.current;
        }
      }
    },
  };
}
