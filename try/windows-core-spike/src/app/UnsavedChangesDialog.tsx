import { Warning24Regular } from "@fluentui/react-icons";
import {
  useEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import type { UnsavedDecision } from "./DocumentSession";

interface UnsavedChangesDialogProps {
  readonly documentName: string;
  readonly onDecision: (decision: UnsavedDecision) => void;
}

export function UnsavedChangesDialog({
  documentName,
  onDecision,
}: UnsavedChangesDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const saveButtonRef = useRef<HTMLButtonElement>(null);
  const onDecisionRef = useRef(onDecision);
  onDecisionRef.current = onDecision;

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    saveButtonRef.current?.focus();
    return () => previous?.focus();
  }, []);

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      onDecisionRef.current("cancel");
      return;
    }
    if (event.key !== "Tab") return;
    const buttons = [...(dialogRef.current?.querySelectorAll<HTMLButtonElement>(
      "button:not([disabled])",
    ) ?? [])];
    if (buttons.length === 0) return;
    const currentIndex = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const nextIndex = event.shiftKey
      ? currentIndex <= 0 ? buttons.length - 1 : currentIndex - 1
      : currentIndex === buttons.length - 1 ? 0 : currentIndex + 1;
    event.preventDefault();
    buttons[nextIndex]?.focus();
  };

  return (
    <div className="modal-backdrop" data-testid="unsaved-dialog-backdrop">
      <div
        ref={dialogRef}
        className="unsaved-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="unsaved-dialog-title"
        aria-describedby="unsaved-dialog-description"
        onKeyDown={handleKeyDown}
      >
        <div className="unsaved-dialog__icon" aria-hidden="true">
          <Warning24Regular />
        </div>
        <div className="unsaved-dialog__content">
          <h2 id="unsaved-dialog-title">保存更改？</h2>
          <p id="unsaved-dialog-description">
            “{documentName}”包含尚未保存的更改。继续前是否保存？
          </p>
        </div>
        <div className="unsaved-dialog__actions">
          <button
            ref={saveButtonRef}
            type="button"
            className="button button--primary"
            onClick={() => onDecision("save")}
          >
            保存并继续
          </button>
          <button
            type="button"
            className="button button--danger-subtle"
            onClick={() => onDecision("discard")}
          >
            不保存
          </button>
          <button
            type="button"
            className="button button--secondary"
            onClick={() => onDecision("cancel")}
          >
            取消
          </button>
        </div>
      </div>
    </div>
  );
}
