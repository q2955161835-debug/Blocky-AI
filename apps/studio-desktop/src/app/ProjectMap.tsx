import { useState } from "react";
import { affectedModules, projectMap } from "@blocky/project-model";
import type { Studio } from "../composition/useStudio";

export function ProjectMap({ studio: s }: { studio: Studio }) {
  const [inspectId, setInspectId] = useState("");
  const modules = projectMap(s.snapshot.project);
  const selected = modules.find((module) => module.moduleId === inspectId) ?? modules.find((module) => module.moduleId === s.session.active);
  const affected = selected ? affectedModules(s.snapshot.project, selected.moduleId) : [];
  return (
    <section className="project-map" aria-label="项目地图">
      <div className="section-label">项目地图</div>
      <div className="project-map-list">
        {modules.map((module) => (
          <button key={module.moduleId} aria-current={module.moduleId === s.session.active ? "page" : undefined}
            onClick={() => {
              setInspectId(module.moduleId);
              s.navigate({ projectId: s.snapshot.project.manifest.projectId, moduleId: module.moduleId });
            }}>
            {module.displayName} <small>{module.purpose} · 引用 {module.outgoing.length} / 被引用 {module.incoming.length}</small>
          </button>
        ))}
      </div>
      {selected && (
        <div className="project-map-impact">
          <strong>{selected.displayName} 的影响</strong>
          <p>{affected.length ? affected.map((id) => modules.find((module) => module.moduleId === id)?.displayName ?? id).join("、") : "没有其他画布依赖此画布"}</p>
          {selected.outgoing.filter((link) => link.broken).map((link) =>
            <p role="alert" key={`${link.blockId}-${link.targetModuleId}`}>引用失效：{link.blockId} → {link.targetModuleId}</p>)}
        </div>
      )}
    </section>
  );
}
