import { useState } from "react";
import type { Studio } from "../composition/useStudio";

const actions = [
  ["edit.group", "分组"], ["edit.ungroup", "取消分组"],
  ["edit.region", "区域"], ["edit.annotate", "注释"],
  ["edit.align-left", "左对齐"], ["edit.align-top", "顶端对齐"],
  ["edit.distribute-horizontal", "水平等距"], ["edit.distribute-vertical", "垂直等距"],
  ["edit.enable", "启用"], ["edit.disable", "停用"],
] as const;
export function EditorTools({ studio: s, execute, enabled }: {
  studio: Studio;
  execute(id: string): void;
  enabled(id: string): boolean;
}) {
  const [target, setTarget] = useState("");
  const modules = s.snapshot.project.manifest.modules.filter((module) => module.moduleId !== s.session.active);
  return (
    <section className="editor-tools" aria-label="所选积木操作">
      <div className="section-label">编辑选择 <span>{s.selectedRoots.length} 个顶层栈</span></div>
      <div className="editor-actions">
        {actions.map(([id, label]) => <button key={id} disabled={!enabled(id)} onClick={() => execute(id)}>{label}</button>)}
      </div>
      <label>复制到画布
        <select value={target} onChange={(event) => setTarget(event.target.value)}>
          <option value="">选择目标画布</option>
          {modules.map((module) => <option key={module.moduleId} value={module.moduleId}>{module.displayName}</option>)}
        </select>
      </label>
      <button disabled={!target || !s.selectedRoots.length || s.running || s.busy}
        onClick={() => s.copySelectionToModule(target)}>复制所选到目标画布</button>
    </section>
  );
}
