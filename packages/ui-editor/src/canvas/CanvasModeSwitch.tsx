import "./canvas-modes.css";

export interface CanvasModeSwitchProps {
  mode: "default" | "pan";
  onChange(mode: "default" | "pan"): void;
  panning?: boolean;
}

export function CanvasModeSwitch({ mode, onChange, panning = false }: CanvasModeSwitchProps) {
  return (
    <div
      className="canvas-mode-switch"
      role="group"
      aria-label="画布操作模式"
      data-canvas-controls="true"
      data-panning={panning}
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onTouchStart={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <button type="button" title="默认鼠标模式" aria-label="默认鼠标模式" aria-pressed={mode === "default"} onClick={() => onChange("default")}>
        <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m6 3 13 10-6 1-3 6z" /></svg>
      </button>
      <button type="button" title="纯拖拽模式" aria-label="纯拖拽模式" aria-pressed={mode === "pan"} onClick={() => onChange("pan")}>
        <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M8 11V5a1.5 1.5 0 0 1 3 0v5-7a1.5 1.5 0 0 1 3 0v7-5a1.5 1.5 0 0 1 3 0v6-3a1.5 1.5 0 0 1 3 0v7c0 4-2.5 6-6 6h-1c-2 0-3.5-1-4.5-2.5L4 12a1.7 1.7 0 0 1 2.5-2z" /></svg>
      </button>
    </div>
  );
}
