import { useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronDownIcon } from "@heroicons/react/20/solid";
import type { Resource } from "@blocky/language-schema";
import type { ReasoningEffort } from "@blocky/builder-protocol";
import { ChatPopover, useChatMenu, type ChatMenuControl } from "./ChatControls";
import { ModelPicker } from "./ModelPicker";
import { ReasoningPicker } from "./ReasoningPicker";

const effortNames: Record<ReasoningEffort, string> = {
  none: "关闭", low: "低", high: "高", max: "最大",
};

/** One compact footer entry; full model and effort controls live above the composer. */
export function ChatModelControl({
  label, modelLabel, reasoningLabel, models, value, effort,
  changeModel, changeEffort, disabled, reasoningDisabled = false, menu: sharedMenu,
  context, target,
}: {
  label: string;
  modelLabel: string;
  reasoningLabel: string;
  models: Resource[];
  value: string;
  effort: ReasoningEffort;
  changeModel(value: string): void;
  changeEffort(value: ReasoningEffort): void;
  disabled: boolean;
  reasoningDisabled?: boolean;
  menu?: ChatMenuControl;
  context?: string;
  target?: ReactNode;
}) {
  const menu = useChatMenu(sharedMenu);
  const [position, setPosition] = useState({ right: 12, bottom: 80, width: 290 });
  const selected = models.find(model => model.resourceId === value);
  const modelName = selected
    ? typeof selected.definition.modelId === "string" ? selected.definition.modelId : selected.displayName
    : value ? "模型不可用" : "选择模型";
  const title = `${context ? `${context} · ` : ""}${selected?.displayName ?? modelName} · 思考：${effortNames[effort]}`;
  return <>
    <button
      type="button"
      className="chat-model-control"
      aria-label={label}
      title={title}
      data-chat-trigger
      aria-haspopup="dialog"
      aria-expanded={menu.value === "model"}
      disabled={disabled}
      onClick={event => {
        event.currentTarget.focus();
        const bounds = event.currentTarget.getBoundingClientRect();
        const width = Math.min(290, window.innerWidth - 24);
        setPosition({ width, right: Math.max(12, Math.min(window.innerWidth - bounds.right, window.innerWidth - width - 12)), bottom: Math.max(12, window.innerHeight - bounds.top + 8) });
        menu.set(menu.value === "model" ? null : "model");
      }}
    >
      <span className="chat-model-control-name">{modelName}</span>
      <span className="chat-model-control-effort">{effortNames[effort]}</span>
      <ChevronDownIcon aria-hidden="true" className="chat-model-control-chevron" />
    </button>
    {createPortal(<ChatPopover
      menu={menu}
      kind="model"
      label={label}
      className="chat-model-popover"
      style={{ position: "fixed", left: "auto", ...position, maxHeight: "min(420px, 70vh)" }}
    >
      {target}
      <label className="chat-model-option">模型
        <ModelPicker label={modelLabel} context={context} models={models} value={value} disabled={disabled} change={changeModel} />
      </label>
      <label className="chat-model-option">思考等级
        <ReasoningPicker label={reasoningLabel} value={effort} model={selected} disabled={disabled || reasoningDisabled} change={changeEffort} />
      </label>
    </ChatPopover>, document.body)}
  </>;
}
