import { catalog, categories, beginnerCategories } from "@blocky/block-catalog";
import type { Studio } from "../composition/useStudio";
import { surfaceTitle } from "@blocky/app-surface";
import type { Blueprint } from "@blocky/block-catalog";
import type { Construction } from "../composition/useConstruction";
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
  construction: c,
  update,
  onContext,
}: {
  studio: Studio;
  search(): void;
  add(type: string): void;
  blueprints: Blueprint[];
  insert(blueprint: Blueprint): void;
  construction: Construction;
  update(mode: "update" | "restore"): void;
  onContext(type: string, x: number, y: number): void;
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
                  onContextMenu={(event) => {
                    event.preventDefault();
                    onContext(b.type, event.clientX, event.clientY);
                  }}
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
        <label className="blueprint-import">
          导入蓝图
          <input
            aria-label="导入蓝图文件"
            type="file"
            accept=".json"
            disabled={c.busy}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void c.importBlueprint(file);
              event.target.value = "";
            }}
          />
        </label>
        {!!c.legacy.length && (
          <button disabled={c.busy} onClick={() => void c.migrateLibrary()}>
            迁移旧蓝图库（{c.legacy.length}）
          </button>
        )}
        {!!c.importedLegacy && (
          <button disabled={c.busy} onClick={() => void c.migrateImported()}>
            将所选旧蓝图迁移为 v1 副本
          </button>
        )}
        <button disabled={c.busy} onClick={() => update("update")}>
          更新所选蓝图
        </button>
        <button disabled={c.busy} onClick={() => update("restore")}>
          还原所选蓝图默认内容
        </button>
        <div className="section-label">项目画布</div>
        {s.snapshot.project.manifest.appSurfaces.map((surface) => (
          <button
            key={surface.surfaceId}
            onClick={() => s.openSurface(surface.surfaceId)}
          >
            ◉ {surfaceTitle(s.snapshot.project, surface.surfaceId)}
          </button>
        ))}
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
