import { walkBlocks } from "@blocky/block-catalog";
import type { Project } from "@blocky/language-schema";
export function RunBudgetSummary({ project }: { project: Project }) {
  const limits = project.manifest.modules.flatMap((module) =>
    [...walkBlocks(project.workspaces[module.moduleId].blocks.blocks)]
      .filter((block) => block.type === "core.run.budget" && !block.disabled)
      .map((block) => ({
        module: module.displayName,
        id: block.id,
        fields: block.fields ?? {},
      })),
  );
  return (
    <details className="run-limits">
      <summary>运行预算</summary>
      <p>总上限：2000 步 · 16 次调用 · 4096 输出 Token · 120 秒</p>
      {limits.map(({ module, id, fields: f }) => (
        <p key={id}>
          {module}：{String(f.STEPS)} 步 · {String(f.CALLS)} 次调用 ·{" "}
          {String(f.OUTPUT_TOKENS)} 输出 Token · {Number(f.TIMEOUT_MS) / 1000}{" "}
          秒
        </p>
      ))}
      {limits.length > 0 && <p>执行到预算积木时收紧上限。</p>}
    </details>
  );
}
