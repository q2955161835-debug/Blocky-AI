import { useEffect, useRef, useState } from "react";
import {
  captureBlueprint,
  parseBlueprint,
  instantiateBlueprint,
  defaultBindings,
  type Blueprint,
  type BlueprintBindings,
} from "@blocky/block-catalog";
import { makePatch, previewPatch, applyPatch } from "@blocky/builder-protocol";
import { conversionCandidate } from "@blocky/conversion-core";
import { digest } from "@blocky/language-schema";
import type { Studio } from "./useStudio";
type Review = Awaited<ReturnType<typeof previewPatch>>;
type Candidate = Awaited<ReturnType<typeof conversionCandidate>>;
export function useConstruction(studio: Studio) {
  const [blueprints, setBlueprints] = useState<Blueprint[]>([]);
  const [captured, setCaptured] = useState<Blueprint>();
  const [inserting, setInserting] = useState<Blueprint>();
  const [name, setName] = useState("我的蓝图");
  const [bindings, setBindings] = useState<BlueprintBindings>({
    resources: {},
    modules: {},
  });
  const [review, setReview] = useState<Review>();
  const [candidate, setCandidate] = useState<Candidate>();
  const [busy, setBusy] = useState(false),
    gate = useRef(false);
  const [clipboard, setClipboard] = useState<Blueprint>();
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const stored = JSON.parse(
          localStorage.getItem("blocky.blueprints.v1") ?? "[]",
        );
        if (!Array.isArray(stored) || stored.length > 100) throw Error();
        const values = await Promise.all(stored.map(parseBlueprint));
        if (active) setBlueprints(values);
      } catch {
        if (active)
          studio.setMessage("本机蓝图库无法读取，请检查导入内容或可用空间。");
      }
    })();
    return () => {
      active = false;
    };
  }, []);
  const perform = async (work: () => Promise<void>) => {
    if (gate.current || studio.busy || studio.running) return false;
    gate.current = true;
    setBusy(true);
    try {
      await work();
      return true;
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      studio.setMessage(
        code === "BLK-PATCH-001"
          ? "项目已改变，请重新生成预览。"
          : code === "BLK-PATCH-003"
            ? "请单独确认新增权限。"
            : code === "BLK-BLUEPRINT-002"
              ? "资源或画布插槽未绑定，原项目保持不变。"
              : "无法完成操作。请检查选区、配置、依赖和本机可用空间。",
      );
      return false;
    } finally {
      gate.current = false;
      setBusy(false);
    }
  };
  const capture = () =>
    perform(async () => {
      const value = await captureBlueprint(
        studio.snapshot.project,
        studio.session.active,
        studio.selectedRoots,
        "我的蓝图",
      );
      setCaptured(value);
      setName(value.displayName);
    });
  const save = () =>
    perform(async () => {
      if (!captured) throw Error();
      const { digest: oldDigest, ...content } = captured;
      const renamed = { ...content, displayName: name };
      const value = await parseBlueprint({
        ...renamed,
        digest: await digest(renamed),
      });
      if (blueprints.length >= 100) throw Error();
      const next = [...blueprints, value];
      const text = JSON.stringify(next);
      if (new TextEncoder().encode(text).length > 2 * 1024 * 1024)
        throw Error();
      localStorage.setItem("blocky.blueprints.v1", text);
      setBlueprints(next);
      setCaptured(undefined);
      studio.setMessage("蓝图已保存到本机");
    });
  const prepareInsert = (blueprint: Blueprint) => {
    setInserting(blueprint);
    setBindings(defaultBindings(blueprint));
  };
  const previewInsert = () =>
    perform(async () => {
      if (!inserting) throw Error();
      const project = studio.controller.getSnapshot().project,
        moduleId = studio.session.active;
      const roots = await instantiateBlueprint(
        inserting,
        project,
        moduleId,
        bindings,
        { x: 450, y: 100 },
      );
      const patch = await makePatch(
        project,
        roots.map((root) => ({
          op: "block.add",
          moduleId,
          blockId: root.id,
          payload: root,
        })),
      );
      setReview(await previewPatch(project, patch));
      setCandidate(undefined);
    });
  const convert = () =>
    perform(async () => {
      const project = studio.controller.getSnapshot().project;
      const resource = project.manifest.resources.find(
        (r) => r.kind === "knowledge",
      );
      if (!resource) throw Error();
      const value = await conversionCandidate(
        project,
        studio.session.active,
        resource.resourceId,
      );
      setReview(await previewPatch(project, value.patch));
      setCandidate(value);
    });
  const accept = (approved: string[]) =>
    perform(async () => {
      if (!review) throw Error();
      const applied = await applyPatch(
        studio.controller,
        review.patch,
        approved,
      );
      const first = applied.patch.operations[0];
      studio.navigate({
        projectId: applied.patch.projectId,
        moduleId: first.moduleId,
        blockId: first.blockId,
      });
      setReview(undefined);
      setCandidate(undefined);
      studio.setMessage("已应用，可整体撤销");
    });
  const reject = () => {
    setReview(undefined);
    setCandidate(undefined);
  };
  const remove = () => {
    studio.controller.edit((p) => {
      const workspace = p.workspaces[studio.session.active];
      if (workspace)
        workspace.blocks.blocks = workspace.blocks.blocks.filter(
          (b) => !studio.selectedRoots.includes(b.id),
        );
    });
    studio.setSelectedRoots([]);
    studio.setSelected(null);
  };
  const copy = (cut = false) =>
    perform(async () => {
      const original = studio.controller.getSnapshot();
      const value = await captureBlueprint(
        original.project,
        studio.session.active,
        studio.selectedRoots,
        "复制的积木",
      );
      if (studio.controller.getSnapshot().revision !== original.revision)
        throw Error("BLK-PATCH-001");
      setClipboard(value);
      if (cut) remove();
      studio.setMessage(cut ? "已剪切积木，可撤销" : "已复制积木");
    });
  const duplicate = () =>
    perform(async () => {
      const project = studio.controller.getSnapshot().project,
        moduleId = studio.session.active;
      const value = await captureBlueprint(
        project,
        moduleId,
        studio.selectedRoots,
        "复制的积木",
      );
      const selected = project.workspaces[moduleId].blocks.blocks.filter((b) =>
        studio.selectedRoots.includes(b.id),
      );
      const roots = await instantiateBlueprint(
        value,
        project,
        moduleId,
        defaultBindings(value),
        {
          x: Math.min(...selected.map((b) => b.x ?? 0)) + 30,
          y: Math.min(...selected.map((b) => b.y ?? 0)) + 30,
        },
      );
      const patch = await makePatch(
        project,
        roots.map((root) => ({
          op: "block.add",
          moduleId,
          blockId: root.id,
          payload: root,
        })),
      );
      await applyPatch(studio.controller, patch, []);
      studio.navigate({
        projectId: project.manifest.projectId,
        moduleId,
        blockId: roots[0].id,
      });
      studio.setMessage("已创建副本，可整体撤销");
    });
  return {
    blueprints,
    captured,
    inserting,
    name,
    setName,
    bindings,
    setBindings,
    review,
    candidate,
    busy,
    clipboard,
    capture,
    save,
    prepareInsert,
    previewInsert,
    convert,
    accept,
    reject,
    remove,
    copy,
    duplicate,
  };
}
export type Construction = ReturnType<typeof useConstruction>;
