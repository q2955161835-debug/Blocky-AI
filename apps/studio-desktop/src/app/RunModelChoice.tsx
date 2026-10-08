import { useState } from "react";
import { referenceUserResource } from "@blocky/resource-registry";
import { walkBlocks } from "@blocky/block-catalog";
import { resolveSetting } from "@blocky/settings-core";
import type { Studio } from "../composition/useStudio";
import { ModelPicker } from "./ModelPicker";
import { ReasoningPicker } from "./ReasoningPicker";

/** A selection updates exactly one explicit block, or a preference for a blank work. */
export function RunModelChoice({
  studio: s,
  compact = false,
}: {
  studio: Studio;
  compact?: boolean;
}) {
  const [targetKey, setTargetKey] = useState("");
  const project = s.snapshot.project;
  const models = [
    ...new Map(
      [...Object.values(project.resources), ...s.resources.map.values()]
        .filter((resource) => resource.kind === "model")
        .map((resource) => [resource.resourceId, resource]),
    ).values(),
  ];
  const targets = Object.entries(project.workspaces).flatMap(
    ([moduleId, workspace]) =>
      [...walkBlocks(workspace.blocks.blocks)]
        .filter((block) =>
          [
            "core.model.compose",
            "core.reason.tool_loop",
            "core.knowledge.correct",
          ].includes(block.type),
        )
        .map((block) => ({
          moduleId,
          block,
          key: `${moduleId}/${block.id}`,
          field: block.type === "core.knowledge.correct" ? "MODEL" : "RESOURCE",
        })),
  );
  const ui = s.settings?.ui;
  const disabled =
    s.running ||
    s.busy ||
    s.exiting ||
    s.resources.ready === false ||
    ui?.ready === false;
  const preferred =
    ui?.values.agentModelId ||
    (s.settings?.layers
      ? String(
          resolveSetting("models.defaultResourceId", s.settings.layers).value ??
            "",
        )
      : "");
  const activeTarget =
    targets.find((target) => target.key === targetKey) ??
    targets.find((target) => target.block.id === s.selected) ??
    targets.find((target) => target.moduleId === s.session?.active) ??
    targets[0];
  const visibleTargets = compact && activeTarget ? [activeTarget] : targets;
  const changeModel = (id: string, target?: (typeof targets)[number]) => {
    const resource = models.find((model) => model.resourceId === id);
    if (!resource) return;
    if (!target) {
      ui?.change("agentModelId", id);
      return;
    }
    s.controller.edit((p) => {
      if (resource.scope === "user")
        Object.assign(p, referenceUserResource(p, resource));
      const selected = [
        ...walkBlocks(p.workspaces[target.moduleId].blocks.blocks),
      ].find((block) => block.id === target.block.id);
      if (selected)
        selected.fields = { ...selected.fields, [target.field]: id };
    });
    void s.save();
  };
  const selectedModel = activeTarget
    ? String(activeTarget.block.fields?.[activeTarget.field] ?? "")
    : preferred;
  return (
    <div className={compact ? "chat-run-model-pickers" : "run-model-settings"}>
      {compact && targets.length > 1 && (
        <select
          className="chat-model-target"
          aria-label="运行模型目标"
          value={activeTarget.key}
          disabled={disabled}
          onChange={(event) => setTargetKey(event.target.value)}
        >
          {targets.map((target) => (
            <option key={target.key} value={target.key}>
              {
                project.manifest.modules.find(
                  (module) => module.moduleId === target.moduleId,
                )?.displayName
              }{" "}
              · {target.block.id}
            </option>
          ))}
        </select>
      )}
      {!targets.length && (
        <ModelPicker
          label={compact ? "快捷运行模型" : "运行模型"}
          context="Blocky Agent 模型偏好"
          models={models}
          value={preferred}
          disabled={disabled || !ui}
          change={(id) => changeModel(id)}
        />
      )}
      {visibleTargets.map((target) => (
        <label
          className={compact ? "chat-run-model-label" : "prompt-label"}
          key={target.key}
        >
          {!compact && (
            <>
              模型 ·{" "}
              {
                project.manifest.modules.find(
                  (module) => module.moduleId === target.moduleId,
                )?.displayName
              }{" "}
              · {target.block.id}
            </>
          )}
          <ModelPicker
            label={`${compact ? "快捷运行模型" : "运行模型"} ${target.block.id}`}
            context={`${project.manifest.modules.find((module) => module.moduleId === target.moduleId)?.displayName} · ${target.block.id}`}
            models={models}
            value={String(target.block.fields?.[target.field] ?? "")}
            disabled={disabled}
            change={(id) => changeModel(id, target)}
          />
        </label>
      ))}
      <ReasoningPicker
        label="Blocky Agent 思考等级"
        model={models.find((model) => model.resourceId === selectedModel)}
        value={ui?.values.agentReasoningEffort ?? "none"}
        disabled={disabled || !ui}
        change={(value) => ui?.change("agentReasoningEffort", value)}
      />
    </div>
  );
}
