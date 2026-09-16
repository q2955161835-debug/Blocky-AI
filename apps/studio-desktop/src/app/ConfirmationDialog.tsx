import { useEffect, useRef } from "react";
export function ConfirmationDialog({
  message,
  answer,
}: {
  message: string;
  answer(value: boolean): void;
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
      <h2 id="confirmation-title">保留当前修改？</h2>
      <p>{message}</p>
      <div className="confirmation-actions">
        <button autoFocus onClick={() => answer(false)}>
          返回编辑
        </button>
        <button onClick={() => answer(true)}>放弃修改并继续</button>
      </div>
    </dialog>
  );
}
