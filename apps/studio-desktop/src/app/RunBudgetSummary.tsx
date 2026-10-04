import { walkBlocks } from "@blocky/block-catalog";
import { agentBudgetDefaults, type Project } from "@blocky/language-schema";
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
  const defaults = agentBudgetDefaults;
  return (
    <details className="run-limits">
      <summary>运行预算</summary>
      <p>
        未设置预算积木时默认：{defaults.steps} 步 · {defaults.calls} 次调用 ·{" "}
        {defaults.outputTokens} 输出 Token · {defaults.durationMs / 1000} 秒
      </p>
      {limits.map(({ module, id, fields: f }) => (
        <p key={id}>
          {module}：{String(f.STEPS)} 步 · {String(f.CALLS)} 次调用 ·{" "}
          {String(f.OUTPUT_TOKENS)} 输出 Token · {Number(f.TIMEOUT_MS) / 1000}{" "}
          秒
        </p>
      ))}
      <p>首个预算积木设置运行上限；后续预算积木只能收紧上限。</p>
    </details>
  );
}
