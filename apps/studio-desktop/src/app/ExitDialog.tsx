import { useEffect, useRef } from "react";
import type { Studio } from "../composition/useStudio";
import type { useLifecycle } from "../composition/useLifecycle";
export function ExitDialog({
  studio,
  lifecycle,
}: {
  studio: Studio;
  lifecycle: ReturnType<typeof useLifecycle>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="popup"
      aria-label="关闭 Blocky Studio"
      onCancel={(e) => {
        e.preventDefault();
        if (lifecycle.canReturn) lifecycle.cancel();
      }}
    >
      <h2>关闭 Blocky Studio</h2>
      <p>
        {studio.snapshot.dirty
          ? "当前项目有未保存的修改。停止并退出将放弃这些修改。"
          : "可以隐藏窗口，或停止任务并退出。"}
      </p>
      {lifecycle.error && <p role="alert">{lifecycle.error}</p>}
      <div className="exit-actions">
        <button disabled={!lifecycle.canReturn} onClick={lifecycle.cancel}>
          返回工作台
        </button>
        <button
          disabled={!lifecycle.canReturn}
          onClick={() => void lifecycle.hide()}
        >
          隐藏并继续
        </button>
        <button
          disabled={lifecycle.working}
          onClick={() => void lifecycle.exit()}
        >
          {lifecycle.working ? "正在结算…" : "停止并退出"}
        </button>
      </div>
    </dialog>
  );
}
