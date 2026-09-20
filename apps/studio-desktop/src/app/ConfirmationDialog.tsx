import { useEffect, useRef } from "react";
import type { ConfirmationLabels } from "../composition/useConfirmation";
export function ConfirmationDialog({
  message,
  answer,
  labels,
}: {
  message: string;
  answer(value: boolean): void;
  labels?: ConfirmationLabels;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="confirmation-dialog"
      aria-labelledby="confirmation-title"
      onCancel={(e) => {
        e.preventDefault();
        answer(false);
      }}
    >
      <h2 id="confirmation-title">{labels?.title ?? "保留当前修改？"}</h2>
      <p>{message}</p>
      <div className="confirmation-actions">
        <button autoFocus onClick={() => answer(false)}>
          {labels?.rejectLabel ?? "返回编辑"}
        </button>
        <button onClick={() => answer(true)}>
          {labels?.acceptLabel ?? "放弃修改并继续"}
        </button>
      </div>
    </dialog>
  );
}
