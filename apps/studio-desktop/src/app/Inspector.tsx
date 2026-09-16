import { getBlock } from "@blocky/block-catalog";
import { findBlock, type Studio } from "../composition/useStudio";
export function Inspector({ studio: s }: { studio: Studio }) {
  const block = s.selected
    ? findBlock(
        s.snapshot.project.workspaces[s.session.active]?.blocks.blocks ?? [],
        s.selected,
      )
    : undefined;
  if (!block)
    return (
      <section className="inspector empty-inspector">
        <span className="section-label">积木配置</span>
        <p>选择画布中的积木，查看角色、资源和调用配置。</p>
      </section>
    );
  const def = getBlock(block.type);
  const resource =
    typeof block.fields?.RESOURCE === "string"
      ? s.snapshot.project.resources[block.fields.RESOURCE]
      : undefined;
  return (
    <section className="inspector">
      <div className="section-label">
        积木配置 <span>{def?.label}</span>
      </div>
      {(def?.fields ?? []).map((field) => (
        <label key={field}>
          {
            (
              {
                ROLE: "角色与指令",
                NAME: "入口名称",
                MODULE: "目标画布",
                EXPORT: "导出接口",
                INPUT: "输入类型",
                OUTPUT: "输出类型",
                RESOURCE: "资源",
                STYLE: "回答方式",
              } as Record<string, string>
            )[field]
          }
          {field === "STYLE" ? (
            <select
              aria-label="回答方式"
              value={String(block.fields?.[field] ?? "条目")}
              onChange={(e) => s.updateField(block.id, field, e.target.value)}
            >
              <option>条目</option>
              <option>段落</option>
            </select>
          ) : field === "ROLE" ? (
            <textarea
              aria-label="角色与指令"
              value={String(block.fields?.[field] ?? "")}
              onChange={(e) => s.updateField(block.id, field, e.target.value)}
            />
          ) : (
            <input
              aria-label={field}
              value={String(block.fields?.[field] ?? "")}
              onChange={(e) => s.updateField(block.id, field, e.target.value)}
            />
          )}
        </label>
      ))}
      {block.type === "core.module.call" && (
        <button
          onClick={() =>
            s.navigate({
              projectId: s.snapshot.project.manifest.projectId,
              moduleId: String(block.fields?.MODULE),
            })
          }
        >
          打开目标画布 ↗
        </button>
      )}
      {resource && (
        <div className="resource-config">
          <div className="section-label">{resource.displayName}</div>
          <small>配置来源：项目资源</small>
          {resource.kind === "knowledge" ? (
            <label>
              资料集合
              <select
                value={String(resource.definition.collection)}
                onChange={(e) =>
                  s.controller.edit((p) => {
                    p.resources[resource.resourceId].definition.collection =
                      e.target.value;
                  })
                }
              >
                <option value="science">自然科学课程</option>
                <option value="blocky">Blocky 使用资料</option>
              </select>
            </label>
          ) : (
            <p>本地确定性回答器</p>
          )}
          <p className="muted">资源引用：{resource.resourceId}</p>
        </div>
      )}
    </section>
  );
}
