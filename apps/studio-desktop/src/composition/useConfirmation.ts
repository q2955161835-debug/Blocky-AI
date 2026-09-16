import { useEffect, useRef, useState } from "react";
export function useConfirmation() {
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const pending = useRef<((answer: boolean) => void) | null>(null);
  useEffect(
    () => () => {
      pending.current?.(false);
      pending.current = null;
    },
    [],
  );
  const answerConfirmation = (answer: boolean) => {
    const resolve = pending.current;
    pending.current = null;
    setConfirmation(null);
    resolve?.(answer);
  };
  const confirm = (message: string): Promise<boolean> => {
    if (pending.current) return Promise.resolve(false);
    return new Promise((resolve) => {
      pending.current = resolve;
      setConfirmation(message);
    });
  };
  return { confirmation, answerConfirmation, confirm };
}
