import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Resource } from "@blocky/language-schema";
export function SecretBindings({
  resource,
  fields,
  change,
}: {
  resource: Resource;
  fields: readonly string[];
  change(bindings: Resource["secretBindings"]): void;
}) {
  const [status, setStatus] = useState(""),
    [variable, setVariable] = useState("API_KEY");
  const bindings = resource.secretBindings;
  return (
    <fieldset>
      <legend>秘密配置</legend>
      <label>
        本地配置变量名
        <input
          aria-label="本地秘密变量名"
          value={variable}
          onChange={(e) => setVariable(e.target.value)}
        />
      </label>
      {fields.map((field) => {
        const ref = bindings.find((b) => b.fieldId === field)?.secretRef ?? "";
        return (
          <div key={field}>
            <label>
              {field} 引用
              <input
                aria-label={`${field}秘密引用`}
                value={ref}
                onChange={(e) =>
                  change([
                    ...bindings.filter((b) => b.fieldId !== field),
                    ...(e.target.value
                      ? [{ fieldId: field, secretRef: e.target.value }]
                      : []),
                  ])
                }
              />
            </label>
            <button
              disabled={!ref}
              onClick={() =>
                void invoke<boolean>("import_secret", { id: ref, variable })
                  .then((ok) => ok && setStatus("已由本机安全存储导入。"))
                  .catch(() =>
                    setStatus("导入失败，请检查引用、变量名和配置文件。"),
                  )
              }
            >
              从本地配置导入
            </button>
            <button
              disabled={!ref}
              onClick={() =>
                void invoke<boolean>("secret_status", { id: ref })
                  .then((ok) => setStatus(ok ? "秘密已保存" : "尚未配置此秘密"))
                  .catch(() => setStatus("无法读取秘密状态。"))
              }
            >
              检查状态
            </button>
          </div>
        );
      })}
      <p role="status">{status}</p>
    </fieldset>
  );
}
