import { useEffect, useRef, useState } from "react";
import {
  codingMessageSchema,
  codingChatStateSchema,
  type CodingMessage,
} from "@blocky/builder-protocol";
import { readUserState, writeUserState } from "./userState";

export type { CodingMessage } from "@blocky/builder-protocol";
function bounded(messages: CodingMessage[]) {
  let bytes = 0,
    length = 0;
  return messages
    .slice(-40)
    .reverse()
    .filter((message) => {
      bytes += new TextEncoder().encode(JSON.stringify(message)).length;
      length += message.text.length;
      return bytes <= 96000 && length <= 64000;
    })
    .reverse();
}
export function codingContext(messages: CodingMessage[]) {
  let length = 0;
  return messages
    .slice(-20)
    .map(({ role, text, status }) => ({
      role,
      text:
        status && status !== "completed"
          ? `[${status}] ${text}`.slice(0, 16000)
          : text,
    }))
    .reverse()
    .filter((message) => {
      length += message.text.length;
      return length <= 64000;
    })
    .reverse();
}
/** Only conversation text persists. Folder grants and editable candidates stay in Host memory. */
export function useCodingChat(
  projectId: string,
  report: (message: string) => void,
) {
  const current = useRef(projectId);
  current.current = projectId;
  const cache = useRef(new Map<string, CodingMessage[]>());
  const touched = useRef(new Set<string>());
  const queue = useRef(Promise.resolve());
  const mounted = useRef(true);
  const [loaded, setLoaded] = useState("");
  const [, refresh] = useState(0);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    if (cache.current.has(projectId)) {
      setLoaded(projectId);
      return;
    }
    void readUserState("coding-chat", projectId)
      .then((raw) => {
        let messages: CodingMessage[] = [];
        if (raw != null) {
          if (new TextEncoder().encode(JSON.stringify(raw)).length > 128000)
            throw Error();
          const value = codingChatStateSchema.parse(raw);
          if (
            value.projectId !== projectId ||
            new Set(value.messages.map((m) => m.id)).size !==
              value.messages.length
          )
            throw Error();
          messages = value.messages.map((message) =>
            message.status === "proposed"
              ? { ...message, status: "stale" }
              : message,
          );
        }
        if (!touched.current.has(projectId))
          cache.current.set(projectId, bounded(messages));
        if (active) {
          setLoaded(projectId);
          refresh((n) => n + 1);
        }
      })
      .catch(() => {
        if (active) {
          report("代码助手对话暂时无法读取，可以开始新对话。");
          setLoaded(projectId);
        }
      });
    return () => {
      active = false;
    };
  }, [projectId]);
  const update = (
    id: string,
    fn: (messages: CodingMessage[]) => CodingMessage[],
  ) => {
    const messages = bounded(fn(cache.current.get(id) ?? [])).map((message) =>
      codingMessageSchema.parse(message),
    );
    const value = {
      schemaVersion: "blocky.coding-chat/v1",
      projectId: id,
      messages,
    };
    touched.current.add(id);
    cache.current.set(id, messages);
    if (mounted.current && current.current === id) refresh((n) => n + 1);
    queue.current = queue.current
      .catch(() => {})
      .then(() => writeUserState("coding-chat", id, value));
    void queue.current.catch(() => {
      if (mounted.current) report("代码助手对话未能保存，请检查可用空间。");
    });
  };
  return {
    ready: loaded === projectId,
    messages: cache.current.get(projectId) ?? [],
    update,
    flush: () => queue.current,
  };
}
