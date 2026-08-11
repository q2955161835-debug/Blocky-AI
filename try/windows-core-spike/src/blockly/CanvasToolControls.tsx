import {
  Cursor20Regular,
  HandLeft20Regular,
} from "@fluentui/react-icons";
import type { CanvasTool } from "./CanvasInteraction";

interface CanvasToolControlsProps {
  readonly tool: CanvasTool;
  readonly onToolChange: (tool: CanvasTool) => void;
}

export function CanvasToolControls({
  tool,
  onToolChange,
}: CanvasToolControlsProps) {
  return (
    <div className="canvas-tool-controls" aria-label="画布工具">
      <button
        type="button"
        aria-label="选择工具 (V)"
        title="选择工具 (V)"
        aria-pressed={tool === "select"}
        onClick={() => onToolChange("select")}
      >
        <Cursor20Regular aria-hidden="true" />
      </button>
      <button
        type="button"
        aria-label="平移工具 (H)"
        title="平移工具 (H)，按住空格可临时使用"
        aria-pressed={tool === "pan"}
        onClick={() => onToolChange("pan")}
      >
        <HandLeft20Regular aria-hidden="true" />
      </button>
    </div>
  );
}
