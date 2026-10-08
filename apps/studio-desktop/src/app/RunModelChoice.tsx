import { referenceUserResource } from "@blocky/resource-registry";
import { walkBlocks } from "@blocky/block-catalog";
import type { Studio } from "../composition/useStudio";
/** A user action changes only the selected model block; no effect-driven project edits. */
export function RunModelChoice({ studio: s }: { studio: Studio }) {
  const project = s.snapshot.project;
  const models = [
    ...Object.values(project.resources),
    ...s.resources.map.values(),
  ].filter((r) => r.kind === "model");
  const targets = Object.entries(project.workspaces).flatMap(([moduleId, w]) =>
    [...walkBlocks(w.blocks.blocks)]
      .filter((b) => b.type === "core.model.compose")
      .map((block) => ({ moduleId, block })),
  );
  if (!targets.length) return null;
  return (
    <div>
      {targets.map(({ moduleId, block }) => (
        <label className="prompt-label" key={`${moduleId}/${block.id}`}>
          模型 ·{" "}
          {
            project.manifest.modules.find((m) => m.moduleId === moduleId)
              ?.displayName
          }
          <select
            aria-label={`运行模型 ${block.id}`}
            value={String(block.fields?.RESOURCE ?? "")}
            disabled={s.running || s.busy}
            onChange={(event) => {
              const id = event.target.value;
              const resource = models.find((r) => r.resourceId === id);
              if (!resource) return;
              s.controller.edit((p) => {
                if (resource.scope === "user")
                  Object.assign(p, referenceUserResource(p, resource));
                const target = [
                  ...walkBlocks(p.workspaces[moduleId].blocks.blocks),
                ].find((b) => b.id === block.id);
                if (target) target.fields = { ...target.fields, RESOURCE: id };
              });
              void s.save();
            }}
          >
            {models.map((r) => (
              <option key={`${r.scope}/${r.resourceId}`} value={r.resourceId}>
                {r.displayName}
              </option>
            ))}
          </select>
        </label>
      ))}
    </div>
  );
}
