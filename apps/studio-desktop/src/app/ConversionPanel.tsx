import { useState } from "react";
import type { useConversion } from "../composition/useConversion";
const labels = {
  "custom-block": "自定义积木",
  blueprint: "可展开蓝图",
  "compatibility-draft": "兼容草案",
  "native-retained": "原生保留",
};
export function ConversionPanel({
  conversion: c,
  showReview,
}: {
  conversion: ReturnType<typeof useConversion>;
  showReview(): void;
}) {
  const [filter, setFilter] = useState("");
  const symbols =
    c.report?.files.flatMap((f) =>
      f.symbols.map((s) => ({ ...s, file: f.path })),
    ) ?? [];
  const visible = symbols.filter((s) =>
    `${s.file} ${s.name}`.toLowerCase().includes(filter.toLowerCase()),
  );
  return (
    <div className="settings conversion-panel">
      <p>选择本机 Git 仓库，查看锁定版本的代码与转换边界。</p>
      <label>
        版本 / commit
        <input
          aria-label="转换版本"
          value={c.reference}
          onChange={(e) => c.setReference(e.target.value)}
          disabled={c.busy}
        />
      </label>
      <label>
        子目录（可选）
        <input
          aria-label="转换子目录"
          value={c.subdir}
          onChange={(e) => c.setSubdir(e.target.value)}
          disabled={c.busy}
        />
      </label>
      <div className="confirmation-actions">
        <button
          disabled={c.busy || !c.reference.trim()}
          onClick={() => void c.scan()}
        >
          选择仓库并分析
        </button>
        {c.artifact && (
          <button disabled={c.busy} onClick={() => void c.resume()}>
            继续分析快照
          </button>
        )}
        {c.busy && <button onClick={c.cancel}>取消分析</button>}
      </div>
      <p role="status">{c.status}</p>
      {c.report && (
        <>
          <p>
            版本 <code>{c.report.artifact.commit}</code> ·{" "}
            {c.report.artifact.fileCount} 个文件 · 许可：
            {c.report.licenseStatus}
          </p>
          <p>
            工作树差异：
            {c.report.workingTree.dirty === "true"
              ? "有变化，本次读取提交内容"
              : c.report.workingTree.dirty === "false"
                ? "检查范围内无变化"
                : "部分无法确认"}
            ；检查 {c.report.workingTree.checked}，变化{" "}
            {c.report.workingTree.changed}，未检查{" "}
            {c.report.workingTree.unchecked}。
          </p>
          <details>
            <summary>检查范围、依赖和升级差异</summary>
            <p>{c.report.workingTree.scope}</p>
            <p>
              新增 {c.report.changes.added.length}，修改{" "}
              {c.report.changes.changed.length}，删除{" "}
              {c.report.changes.removed.length}；当前作品保持不变。
            </p>
            <pre>
              {JSON.stringify(
                {
                  dependencies: c.report.dependencies,
                  changes: c.report.changes,
                  excluded: c.report.excluded,
                },
                null,
                2,
              )}
            </pre>
            <p>
              排除 {c.report.excludedCount} 项
              {c.report.excludedTruncated ? "（显示摘要）" : ""}。
              {c.report.dependencies.some((d) => d.locked)
                ? "发现锁文件，尚未安装或验证上游依赖。"
                : "未发现依赖锁文件，依赖版本未锁定。"}
            </p>
          </details>
          {c.report.licenses.map((l) => (
            <details key={l.file}>
              <summary>
                {l.file} · {l.detected}
              </summary>
              <code>{l.sha256}</code>
              <pre>{l.text}</pre>
            </details>
          ))}
          <label>
            查找文件或符号
            <input
              aria-label="筛选转换符号"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </label>
          <p>{visible.length} 个符号，显示前 50 项；可筛选缩小范围。</p>
          {visible.slice(0, 50).map((s) => (
            <section key={`${s.file}:${s.lineStart}`}>
              <strong>
                {s.name} · {labels[s.decision]}
              </strong>
              <p>
                {s.file}:{s.lineStart}–{s.lineEnd}
              </p>
              <p>{s.rationale}</p>
              <button
                disabled={c.busy}
                onClick={() => void c.openSource(s.file)}
              >
                查看源码
              </button>
              {s.program && (
                <button
                  disabled={c.busy || c.report?.licenseStatus === "unverified"}
                  onClick={async () => {
                    if (
                      await c.candidate({
                        file: s.file,
                        symbol: s.name,
                        lineStart: s.lineStart,
                      })
                    )
                      showReview();
                  }}
                >
                  生成候选预览
                </button>
              )}
            </section>
          ))}
          <ul>
            {c.report.compatibilityReport.retained.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </>
      )}
      {c.source && (
        <details open>
          <summary>{c.source.path}</summary>
          <pre>{c.source.content}</pre>
        </details>
      )}
    </div>
  );
}
