import { useEffect, useRef, useState } from "react";
import { workflowJson } from "@blocky/runtime-core";
import type { Json } from "@blocky/language-schema";
import type { WorkflowReconciliation as Choice } from "../composition/workflow";

export function WorkflowReconciliation({
  disabled,
  onReview,
}: {
  disabled: boolean;
  onReview(choice: Choice): void;
}) {
  const [outcome, setOutcome] = useState(""),
    [checkpoint, setCheckpoint] = useState<{ state: Json }>(),
    [message, setMessage] = useState("");
  const reading = useRef<FileReader | undefined>(undefined);
  useEffect(() => () => reading.current?.abort(), []);
  const clear = () => {
    reading.current?.abort();
    reading.current = undefined;
    setCheckpoint(undefined);
    setMessage("");
  };
  const load = (file?: File) => {
    clear();
    if (!file) return;
    const invalid = () =>
      setMessage(
        "检查点无效，请选择核对后的完整 JSON 文件（不超过 128 KiB）。",
      );
    if (file.size > 131072) {
      invalid();
      return;
    }
    const reader = new FileReader();
    reading.current = reader;
    reader.onload = () => {
      if (reading.current !== reader) return;
      try {
        setCheckpoint({
          state: workflowJson(JSON.parse(String(reader.result))),
        });
      } catch {
        invalid();
      }
      reading.current = undefined;
    };
    reader.onerror = () => {
      if (reading.current === reader) {
        reading.current = undefined;
        invalid();
      }
    };
    reader.readAsText(file, "utf-8");
  };
  return (
    <details>
      <summary>人工核对</summary>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (disabled) return;
          if (outcome === "not-executed") onReview({ outcome });
          else if (outcome === "completed" && checkpoint)
            onReview({ outcome, state: checkpoint.state });
        }}
      >
        <p>
          先检查实际执行结果。只有执行已停止且账本有停止凭据的任务才能核对。
        </p>
        <label>
          核对结果
          <select
            disabled={disabled}
            value={outcome}
            onChange={(event) => {
              clear();
              setOutcome(event.target.value);
            }}
          >
            <option value="">请选择</option>
            <option value="not-executed">此步骤未执行</option>
            <option value="completed">此步骤已完成</option>
          </select>
        </label>
        {outcome === "completed" && (
          <>
            <p>导入包含已核对输出、记忆和剩余预算的完整检查点。</p>
            <label>
              核对后的检查点
              <input
                type="file"
                accept=".json,application/json"
                disabled={disabled}
                onChange={(event) => load(event.target.files?.[0])}
              />
            </label>
          </>
        )}
        {message && <p role="status">{message}</p>}
        <button
          disabled={
            disabled || !outcome || (outcome === "completed" && !checkpoint)
          }
        >
          预检核对
        </button>
      </form>
    </details>
  );
}
