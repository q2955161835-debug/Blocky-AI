import { useState } from "react";
import { blueprintInstance, officialStarters } from "@blocky/block-catalog";
import type { Studio } from "../composition/useStudio";
export function StarterGuide({
  studio: s,
  resources,
}: {
  studio: Studio;
  resources(): void;
}) {
  const [closedFor, setClosedFor] = useState("");
  const project = s.snapshot.project;
  const root = Object.values(project.workspaces)
    .flatMap((w) => w.blocks.blocks)
    .find((b) => blueprintInstance(b)?.blueprintId.startsWith("official-"));
  const origin = root && blueprintInstance(root);
  const starter = officialStarters.find(
    (t) => `official-${t.id}` === origin?.blueprintId,
  );
  if (!starter || closedFor === project.manifest.projectId) return null;
  return (
    <details className="starter-guide" open>
      <summary>第一次任务 · {starter.displayName}</summary>
      <ol>
        {starter.steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      <div>
        <button
          disabled={s.busy || s.running}
          onClick={() => s.setQuestion(starter.sampleInput)}
        >
          填入示例问题
        </button>
        {starter.id !== "task-helper" && (
          <button onClick={resources}>添加或更换资料</button>
        )}
        <button
          onClick={() => {
            const module = Object.entries(project.workspaces).find(([, w]) =>
              w.blocks.blocks.some((b) => b.id === root?.id),
            );
            if (module && root) {
              s.navigate({
                projectId: project.manifest.projectId,
                moduleId: module[0],
                blockId: root.id,
              });
              s.setSelectedRoots([root.id]);
            }
          }}
        >
          修改角色与积木
        </button>
        <button onClick={() => setClosedFor(project.manifest.projectId)}>
          收起任务引导
        </button>
      </div>
    </details>
  );
}
