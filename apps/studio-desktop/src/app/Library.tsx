import { catalog, categories, beginnerCategories } from "@blocky/block-catalog";
import type { Studio } from "../composition/useStudio";
import type { Blueprint } from "@blocky/block-catalog";
const projection: Record<number, number> = {
  0: 0,
  1: 1,
  2: 1,
  3: 2,
  4: 3,
  5: 4,
  6: 5,
  7: 5,
  8: 5,
  9: 5,
  10: 5,
  11: 6,
};
export function Library({
  studio: s,
  search,
  add,
  blueprints,
  insert,
}: {
  studio: Studio;
  search(): void;
  add(type: string): void;
  blueprints: Blueprint[];
  insert(blueprint: Blueprint): void;
}) {
  const paletteNames =
    s.preferences.view === "beginner" ? beginnerCategories : categories;
  return (
    <aside className="library">
      <div className="sidebar-heading">
        积木库
        <button aria-label="搜索积木" onClick={() => search()}>
          ⌕
        </button>
      </div>
      <div className="view-switch">
        <button
          className={s.preferences.view === "beginner" ? "active" : ""}
          onClick={() => s.setPreferences((v) => ({ ...v, view: "beginner" }))}
        >
          入门
        </button>
        <button
          className={s.preferences.view === "professional" ? "active" : ""}
          onClick={() =>
            s.setPreferences((v) => ({ ...v, view: "professional" }))
          }
        >
          专业
        </button>
      </div>
      <div className="palette">
        {paletteNames.map((name, i) => {
          const blocks = catalog.filter(
            (b) =>
              (s.preferences.view === "beginner"
                ? projection[b.category]
                : b.category) === i,
          );
          return (
            <section key={name}>
              <h3>
                <span style={{ background: blocks[0]?.color ?? "#56606f" }} />
                {name}
              </h3>
              {blocks.map((b) => (
                <button
                  key={b.type}
                  className="palette-block"
                  style={{ borderLeftColor: b.color }}
                  onClick={() => add(b.type)}
                >
                  {b.label}
                  <span>＋</span>
                </button>
              ))}
              {!blocks.length && (
                <small className="unavailable">暂无积木</small>
              )}
            </section>
          );
        })}
      </div>
      <div className="module-list">
        <div className="section-label">个人蓝图</div>
        {blueprints.map((blueprint) => (
          <button key={blueprint.blueprintId} onClick={() => insert(blueprint)}>
            {blueprint.displayName} ＋
          </button>
        ))}
        {!blueprints.length && (
          <small className="muted">选择积木后可保存为蓝图</small>
        )}
        <div className="section-label">项目画布</div>
        {s.snapshot.project.manifest.modules.map((m) => (
          <button
            key={m.moduleId}
            onClick={() =>
              s.navigate({
                projectId: s.snapshot.project.manifest.projectId,
                moduleId: m.moduleId,
              })
            }
          >
            ▧ {m.displayName}
          </button>
        ))}
      </div>
    </aside>
  );
}
