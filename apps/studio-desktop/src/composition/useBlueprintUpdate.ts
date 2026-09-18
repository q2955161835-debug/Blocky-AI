import { useState } from "react";
import {
  blueprintInstance,
  previewBlueprintUpdate,
  type Blueprint,
  type BlueprintUpdate,
} from "@blocky/block-catalog";
import { makePatch, previewPatch } from "@blocky/builder-protocol";
import type { Studio } from "./useStudio";
export function useBlueprintUpdate(
  studio: Studio,
  templates: Blueprint[],
  show: (review: Awaited<ReturnType<typeof previewPatch>>) => void,
) {
  const [rootId, setRootId] = useState(""),
    [template, setTemplate] = useState<Blueprint>();
  const [mode, setMode] = useState<"update" | "restore">("update");
  const [resolution, setResolution] = useState<"" | "keep-user" | "upstream">(
    "",
  );
  const [details, setDetails] = useState<BlueprintUpdate>(),
    [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const roots =
    studio.snapshot.project.workspaces[studio.session.active]?.blocks.blocks ??
    [];
  const target =
    roots.find(
      (b) => studio.selectedRoots.includes(b.id) && blueprintInstance(b),
    ) ?? roots.find((b) => b.id === studio.selected && blueprintInstance(b));
  const prepare = (nextMode: "update" | "restore") => {
    if (!target) {
      studio.setMessage("请先选中一个蓝图的顶层积木。");
      return false;
    }
    const instance = blueprintInstance(target)!;
    setRootId(target.id);
    setMode(nextMode);
    setDetails(undefined);
    setResolution("");
    setStatus("");
    const matching = templates
      .filter((t) => t.blueprintId === instance.blueprintId)
      .sort((a, b) => b.version - a.version);
    setTemplate(matching[0]);
    return true;
  };
  const instance = roots.find((b) => b.id === rootId);
  const state = instance && blueprintInstance(instance);
  const available = templates.filter(
    (t) => t.blueprintId === state?.blueprintId,
  );
  return {
    mode,
    rootId,
    state,
    template,
    setTemplate,
    resolution,
    setResolution,
    details,
    status,
    busy,
    available,
    prepare,
    preview: async () => {
      if (!template || busy) return false;
      setBusy(true);
      setStatus("");
      try {
        const project = studio.controller.getSnapshot().project,
          moduleId = studio.session.active;
        const update = await previewBlueprintUpdate(
          project,
          moduleId,
          rootId,
          template,
          mode,
          resolution || undefined,
        );
        setDetails(update);
        if (update.conflicts.length && !resolution) {
          setStatus("发现冲突，请选择处理方式后重新生成预览。");
          return false;
        }
        const patch = await makePatch(
          project,
          [
            ...update.changes
              .filter((c) => c.before)
              .map((c) => ({
                op: "block.remove" as const,
                moduleId,
                blockId: c.before!.id,
              })),
            ...update.changes
              .filter((c) => c.after)
              .map((c) => ({
                op: "block.add" as const,
                moduleId,
                blockId: c.after!.id,
                payload: c.after!,
              })),
          ],
          studio.resources.map,
        );
        show(await previewPatch(project, patch, studio.resources.map));
        return true;
      } catch (error) {
        setStatus(
          error instanceof Error && error.message === "BLK-BLUEPRINT-005"
            ? "没有更高版本，或所选蓝图与来源不匹配。可导入新版蓝图后再更新。"
            : "无法生成预览，请检查公开插槽和当前项目。",
        );
        return false;
      } finally {
        setBusy(false);
      }
    },
  };
}
