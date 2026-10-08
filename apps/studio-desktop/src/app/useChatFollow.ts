import { useCallback, useLayoutEffect, useRef } from "react";
import type { RefObject, UIEventHandler } from "react";

const BOTTOM_THRESHOLD = 48;

export function useChatFollow(
  resetKey: string,
  changeToken: unknown,
): {
  ref: RefObject<HTMLDivElement | null>;
  onScroll: UIEventHandler<HTMLDivElement>;
} {
  const ref = useRef<HTMLDivElement>(null);
  const followsBottom = useRef(true);
  const lastResetKey = useRef(resetKey);

  const scrollToBottom = useCallback(() => {
    const thread = ref.current;
    if (thread)
      thread.scrollTop = Math.max(0, thread.scrollHeight - thread.clientHeight);
  }, []);

  const onScroll = useCallback<UIEventHandler<HTMLDivElement>>((event) => {
    const thread = event.currentTarget;
    followsBottom.current =
      thread.scrollHeight - thread.clientHeight - thread.scrollTop <=
      BOTTOM_THRESHOLD;
  }, []);

  useLayoutEffect(() => {
    const changedConversation = lastResetKey.current !== resetKey;
    if (changedConversation) {
      lastResetKey.current = resetKey;
      followsBottom.current = true;
    }
    if (changedConversation || followsBottom.current) scrollToBottom();
  }, [changeToken, resetKey, scrollToBottom]);

  useLayoutEffect(() => {
    const thread = ref.current;
    if (!thread) return;

    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => {
            if (followsBottom.current) scrollToBottom();
          });
    const observed = new WeakSet<Element>();
    const observe = (element: Element) => {
      if (!resizeObserver) return;
      if (observed.has(element)) return;
      observed.add(element);
      resizeObserver.observe(element);
    };
    observe(thread);
    for (const child of thread.children) observe(child);

    const mutationObserver =
      typeof MutationObserver === "undefined"
        ? null
        : new MutationObserver((records) => {
            for (const record of records) {
              if (record.target !== thread) continue;
              for (const node of record.addedNodes) {
                if (node instanceof Element) observe(node);
              }
            }
            if (followsBottom.current) scrollToBottom();
          });
    mutationObserver?.observe(thread, {
      childList: true,
      characterData: true,
      subtree: true,
    });

    return () => {
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
    };
  }, [scrollToBottom]);

  return { ref, onScroll };
}
