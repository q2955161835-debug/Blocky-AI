import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { RunResult, OutputFile } from "@blocky/runtime-core";
export function RunOutputs({ result }: { result: RunResult }) {
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const save = async (file: OutputFile) => {
    setSaving(true);
    setMessage("");
    try {
      const value = await invoke<{ saved: boolean }>("agent_output_save", {
        request: file,
      });
      setMessage(value.saved ? "文件已保存" : "已取消保存");
    } catch {
      setMessage("文件未保存，请检查目标位置。");
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      {result.generations?.map((generation, index) => (
        <p className="muted" key={index}>
          {generation.transport === "remote" ? "在线模型" : "本地处理"} ·{" "}
          {generation.model}
          {generation.usage
            ? ` · 输入 ${generation.usage.inputTokens} / 输出 ${generation.usage.outputTokens} Token`
            : ""}
        </p>
      ))}
      {result.structured !== undefined && (
        <details open>
          <summary>结构化结果</summary>
          <pre>{JSON.stringify(result.structured, null, 2)}</pre>
        </details>
      )}
      {result.files?.map((file, index) => (
        <div key={index}>
          <button disabled={saving} onClick={() => void save(file)}>
            保存 {file.name}
          </button>
        </div>
      ))}
      {message && <p role="status">{message}</p>}
    </>
  );
}
