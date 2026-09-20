import { useEffect, useRef, useState } from "react";
export type ConfirmationLabels = {
  title: string;
  acceptLabel: string;
  rejectLabel: string;
};
export function useConfirmation() {
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [confirmationLabels, setConfirmationLabels] =
    useState<ConfirmationLabels>();
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
    setConfirmationLabels(undefined);
    resolve?.(answer);
  };
  const confirm = (
    message: string,
    labels?: ConfirmationLabels,
  ): Promise<boolean> => {
    if (pending.current) return Promise.resolve(false);
    return new Promise((resolve) => {
      pending.current = resolve;
      setConfirmation(message);
      setConfirmationLabels(labels);
    });
  };
  return { confirmation, confirmationLabels, answerConfirmation, confirm };
}
