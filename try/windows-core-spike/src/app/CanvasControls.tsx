import {
  Add20Regular,
  Play20Filled,
  Save20Regular,
  Subtract20Regular,
  ZoomFit20Regular,
} from "@fluentui/react-icons";

export interface CanvasControlsProps {
  readonly zoomPercent: number;
  readonly onSave: () => void;
  readonly onRun: () => void;
  readonly onZoomOut: () => void;
  readonly onZoomIn: () => void;
  readonly onFit: () => void;
}

export function CanvasControls({
  zoomPercent,
  onSave,
  onRun,
  onZoomOut,
  onZoomIn,
  onFit,
}: CanvasControlsProps) {
  return (
    <>
      <div className="canvas-controls__primary" aria-label="画布项目操作">
        <button
          type="button"
          className="canvas-controls__save icon-button"
          aria-label="保存项目"
          title="保存项目"
          onClick={onSave}
        >
          <Save20Regular aria-hidden="true" />
        </button>
        <button type="button" className="canvas-controls__run" onClick={onRun}>
          <Play20Filled aria-hidden="true" />
          <span>运行</span>
        </button>
      </div>
      <div className="canvas-controls__zoom" aria-label="画布缩放">
        <button type="button" aria-label="缩小画布" title="缩小画布" onClick={onZoomOut}>
          <Subtract20Regular aria-hidden="true" />
        </button>
        <output aria-label="当前画布缩放">{zoomPercent}%</output>
        <button type="button" aria-label="放大画布" title="放大画布" onClick={onZoomIn}>
          <Add20Regular aria-hidden="true" />
        </button>
        <span className="canvas-controls__separator" aria-hidden="true" />
        <button type="button" aria-label="适配画布" title="适配画布" onClick={onFit}>
          <ZoomFit20Regular aria-hidden="true" />
        </button>
      </div>
    </>
  );
}
