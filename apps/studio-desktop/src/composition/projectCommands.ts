import {
  createModule,
  deleteModule,
  closeTab,
  restoreTab,
  cycleTab,
  moveTab,
  activateTab,
} from "@blocky/project-model";
import type { Studio } from "./useStudio";
export function projectCommands(
  s: Studio,
  confirm: (message: string) => Promise<boolean>,
): Record<string, () => unknown> {
  const validIds = () => [
    ...s.snapshot.project.manifest.modules.map((m) => m.moduleId),
    ...s.snapshot.project.manifest.appSurfaces.map(
      (a) => `surface:${a.surfaceId}`,
    ),
  ];
  return {
    "file.save-as": () => s.save(true),
    "file.new-canvas": () => {
      const id = `module-${crypto.randomUUID()}`;
      s.controller.edit((p) =>
        createModule(p, id, `画布 ${p.manifest.modules.length + 1}`),
      );
      s.setSession((v) => activateTab({ ...v, tabs: [...v.tabs, id] }, id));
    },
    "edit.rename-canvas": () =>
      document
        .querySelector<HTMLInputElement>('[aria-label="画布名称"]')
        ?.select(),
    "edit.delete-canvas": async () => {
      const id = s.session.active;
      if (
        !(await confirm(
          "删除当前画布后，其调用位置会显示失效引用；可撤销恢复。继续删除？",
        ))
      )
        return;
      try {
        s.controller.edit((p) => deleteModule(p, id));
      } catch {
        s.setMessage("至少保留一个画布，或当前目标已不存在。");
      }
    },
    "view.close-tab": () => s.setSession((v) => closeTab(v)),
    "view.restore-tab": () => s.setSession((v) => restoreTab(v, validIds())),
    "view.next-tab": () => s.setSession((v) => cycleTab(v, 1)),
    "view.previous-tab": () => s.setSession((v) => cycleTab(v, -1)),
    "view.move-tab-left": () => s.setSession((v) => moveTab(v, -1)),
    "view.move-tab-right": () => s.setSession((v) => moveTab(v, 1)),
  };
}
