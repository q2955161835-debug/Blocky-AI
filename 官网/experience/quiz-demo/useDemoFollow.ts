import { useLayoutEffect, type RefObject } from 'react';

/** Playback owns the reading position; track rendered size as well as text changes. */
export function useDemoFollow(ref: RefObject<HTMLDivElement | null>, active: boolean, changeToken: string) {
  useLayoutEffect(() => {
    const element = ref.current;
    if (!active || !element) return;
    let frame = 0;
    const follow = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => { element.scrollTop = element.scrollHeight; });
    };
    follow();
    const resize = new ResizeObserver(follow);
    resize.observe(element);
    for (const child of element.children) resize.observe(child);
    const mutation = new MutationObserver(follow);
    mutation.observe(element, { childList: true, subtree: true, characterData: true });
    return () => { cancelAnimationFrame(frame); resize.disconnect(); mutation.disconnect(); };
  }, [active, changeToken, ref]);
}
