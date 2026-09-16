import { useEffect, useRef } from "react";
/** One focus boundary for every mutually exclusive workbench dialog. */
export function useModalFocus(key: string) {
  const returnTo = useRef<HTMLElement | null>(null);
  const dialogFocus = useRef(new WeakMap<Element, HTMLElement>());
  useEffect(() => {
    const remember = (event: FocusEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement) {
        const owner = target.closest(
          'dialog,[role="dialog"],[role="alertdialog"]',
        );
        if (owner) dialogFocus.current.set(owner, target);
      }
      if (
        target instanceof HTMLElement &&
        !target.closest('dialog,[role="dialog"],[role="alertdialog"]')
      )
        returnTo.current = target;
    };
    document.addEventListener("focusin", remember);
    return () => document.removeEventListener("focusin", remember);
  }, []);
  useEffect(() => {
    if (!key) {
      if (returnTo.current?.isConnected) returnTo.current.focus();
      return;
    }
    const nativeDialogs = [
      ...document.querySelectorAll<HTMLElement>(
        'dialog[open],[role="alertdialog"]',
      ),
    ];
    const dialog =
      nativeDialogs.at(-1) ??
      document.querySelector<HTMLElement>('[role="dialog"]');
    if (!dialog) return;
    const focusable = () =>
      [
        ...dialog.querySelectorAll<HTMLElement>(
          'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]',
        ),
      ].filter((e) => !e.closest("[hidden]"));
    if (!dialog.contains(document.activeElement)) {
      const remembered = dialogFocus.current.get(dialog);
      if (remembered?.isConnected && !remembered.matches(":disabled"))
        remembered.focus();
      else focusable()[0]?.focus();
    }
    const trap = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const items = focusable();
      if (!items.length) {
        e.preventDefault();
        return;
      }
      const index = items.indexOf(document.activeElement as HTMLElement);
      if (
        index === -1 ||
        (!e.shiftKey && index === items.length - 1) ||
        (e.shiftKey && index === 0)
      ) {
        e.preventDefault();
        e.stopPropagation();
        items[e.shiftKey ? items.length - 1 : 0].focus();
      }
    };
    document.addEventListener("keydown", trap, true);
    return () => document.removeEventListener("keydown", trap, true);
  }, [key]);
}
