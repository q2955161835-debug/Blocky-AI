import { useEffect, useRef, useState } from "react";
import type { Studio } from "../composition/useStudio";
import type { Construction } from "../composition/useConstruction";
import { GhostBlocks } from "./GhostBlocks";
import { ConversionPanel } from "./ConversionPanel";
export type ConstructionKind =
  | "blueprint-save"
  | "blueprint-insert"
  | "patch-review"
  | "conversion";
export function ConstructionDialog({
  studio: s,
  construction: c,
  kind,
  close,
  showReview,
}: {
  studio: Studio;
  construction: Construction;
  kind: ConstructionKind;
  close(): void;
  showReview(): void;
}) {
  const [approved, setApproved] = useState<string[]>([]);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const title =
    kind === "blueprint-save"
      ? "保存为蓝图"
      : kind === "blueprint-insert"
        ? "插入蓝图"
        : kind === "conversion"
          ? "项目积木化"
          : "审阅变更";
  return (
    <dialog
      ref={dialog}
      className="popup construction-dialog"
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        if (!c.busy) {
          c.reject();
          close();
        }
      }}
    >
      <header>
        <strong>{title}</strong>
        <button
          aria-label="关闭弹层"
          disabled={c.busy}
          onClick={() => {
            c.reject();
            close();
          }}
        >
          ×
        </button>
      </header>
      {kind === "conversion" && (
        <ConversionPanel conversion={c.conversion} showReview={showReview} />
      )}
      {kind === "blueprint-save" && (
        <div className="settings">
          <label>
            名称
            <input
              aria-label="蓝图名称"
              value={c.name}
              maxLength={100}
              onChange={(e) => c.setName(e.target.value)}
            />
          </label>
          <p>{c.captured?.roots.length} 组顶层积木，将保留相对布局。</p>
          <p>
            公开插槽：
            {c.captured?.resources
              .map((r) => r.defaultResourceId)
              .concat(
                c.captured.modules.map(
                  (m) => `${m.defaultModuleId} / ${m.exportId}`,
                ),
              )
              .join("、") || "无外部依赖"}
          </p>
          <button
            className="primary"
            disabled={c.busy || !c.name.trim()}
            onClick={async () => {
              if (await c.save()) close();
            }}
          >
            保存到本机
          </button>
        </div>
      )}
      {kind === "blueprint-insert" && (
        <div className="settings">
          <strong>{c.inserting?.displayName}</strong>
          <p>确认公开插槽的目标后生成预览。</p>
          {c.inserting?.resources.map((slot) => (
            <label key={slot.slotId}>
              资源 · {slot.kind}
              <select
                aria-label={slot.slotId}
                value={c.bindings.resources[slot.slotId] ?? ""}
                onChange={(e) =>
                  c.setBindings((b) => ({
                    ...b,
                    resources: {
                      ...b.resources,
                      [slot.slotId]: e.target.value,
                    },
                  }))
                }
              >
                <option value="">选择资源</option>
                {s.snapshot.project.manifest.resources
                  .filter((r) => r.kind === slot.kind)
                  .map((r) => (
                    <option key={r.resourceId} value={r.resourceId}>
                      {s.snapshot.project.resources[r.resourceId]
                        ?.displayName ?? r.resourceId}
                    </option>
                  ))}
              </select>
            </label>
          ))}
          {c.inserting?.modules.map((slot) => (
            <label key={slot.slotId}>
              画布 · {slot.exportId}
              <select
                aria-label={slot.slotId}
                value={c.bindings.modules[slot.slotId] ?? ""}
                onChange={(e) =>
                  c.setBindings((b) => ({
                    ...b,
                    modules: { ...b.modules, [slot.slotId]: e.target.value },
                  }))
                }
              >
                <option value="">选择画布</option>
                {s.snapshot.project.manifest.modules
                  .filter((m) =>
                    m.exports.some(
                      (e) =>
                        e.exportId === slot.exportId &&
                        e.inputSchemaRef === slot.inputSchemaRef &&
                        e.outputSchemaRef === slot.outputSchemaRef,
                    ),
                  )
                  .map((m) => (
                    <option key={m.moduleId} value={m.moduleId}>
                      {m.displayName}
                    </option>
                  ))}
              </select>
            </label>
          ))}
          <button
            className="primary"
            disabled={c.busy}
            onClick={async () => {
              if (await c.previewInsert()) showReview();
            }}
          >
            生成预览
          </button>
        </div>
      )}
      {kind === "patch-review" && c.review && (
        <div className="patch-review">
          {c.candidate && (
            <>
              <h3>{c.candidate.displayName}</h3>
              <p>{c.candidate.rationale}</p>
              <p>
                源仓库：{c.candidate.source.repository} ·{" "}
                {c.candidate.source.version} · {c.candidate.source.license}
              </p>
              <code>{c.candidate.source.commit}</code>
              <details>
                <summary>搭建说明与输入输出</summary>
                <pre>
                  {JSON.stringify(
                    {
                      buildSpec: c.candidate.buildSpec,
                      interface: c.candidate.interface,
                    },
                    null,
                    2,
                  )}
                </pre>
              </details>
              {c.candidate.evidence.map((e) => (
                <details key={e.file}>
                  <summary>
                    {e.file} · {e.lineStart}–{e.lineEnd}
                  </summary>
                  <pre>{e.excerpt}</pre>
                </details>
              ))}
              <ul>
                {c.candidate.retained.map((text) => (
                  <li key={text}>{text}</li>
                ))}
              </ul>
            </>
          )}
          <div className="ghost-preview" aria-label="幽灵积木预览">
            {c.review.changes.map((change, i) => (
              <section key={i}>
                <h4>
                  {
                    s.snapshot.project.manifest.modules.find(
                      (m) => m.moduleId === change.moduleId,
                    )?.displayName
                  }
                </h4>
                {"surface" in change && change.surface ? (
                  <div aria-label="应用界面文件变更">
                    <p>
                      新增 {change.surface.manifest.displayName} ·
                      入口权限需单独确认
                    </p>
                    {Object.entries(change.surface.files).map(
                      ([path, value]) => (
                        <details key={path}>
                          <summary>新增 {path}</summary>
                          <pre>
                            {typeof value === "string"
                              ? value
                              : JSON.stringify(value, null, 2)}
                          </pre>
                        </details>
                      ),
                    )}
                  </div>
                ) : (
                  <div className="patch-diff">
                    <div>
                      <p>原来</p>
                      <GhostBlocks block={change.before} />
                    </div>
                    <div>
                      <p>应用后</p>
                      <GhostBlocks block={change.after} />
                    </div>
                  </div>
                )}
                <details>
                  <summary>查看结构差异</summary>
                  <pre>{JSON.stringify(change, null, 2)}</pre>
                </details>
              </section>
            ))}
          </div>
          <h3>新增权限</h3>
          {!c.review.permissionDelta.length && <p>无新增权限</p>}
          {c.review.permissionDelta.map((permission) => (
            <label className="permission-choice" key={permission}>
              <input
                type="checkbox"
                checked={approved.includes(permission)}
                onChange={(e) =>
                  setApproved((values) =>
                    e.target.checked
                      ? [...values, permission]
                      : values.filter((v) => v !== permission),
                  )
                }
              />
              {permission}
            </label>
          ))}
          <div className="confirmation-actions">
            <button
              disabled={c.busy}
              onClick={() => {
                c.reject();
                close();
              }}
            >
              拒绝
            </button>
            <button
              className="primary"
              disabled={
                c.busy ||
                c.review.permissionDelta.some((p) => !approved.includes(p))
              }
              onClick={async () => {
                if (await c.accept(approved)) close();
              }}
            >
              接受变更
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}
