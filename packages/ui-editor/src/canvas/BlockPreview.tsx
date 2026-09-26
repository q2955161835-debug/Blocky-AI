import { useEffect, useRef, useState } from "react";
import type { WorkspaceBlock } from "@blocky/language-schema";
import { Blockly, registerBlocks, theme } from "../blocks";
import { applyCodeVisuals } from "./code-visuals";
/** Separate read-only Blockly workspace: never connected to project edits or selection. */
export function BlockPreview({ block }: { block: WorkspaceBlock }) {
  const root = useRef<HTMLDivElement>(null),
    editor = useRef<Blockly.WorkspaceSvg | null>(null),
    [error, setError] = useState(false);
  useEffect(() => {
    registerBlocks();
    setError(false);
    const ws = Blockly.inject(root.current!, {
      readOnly: true,
      theme,
      renderer: "zelos",
      sounds: false,
      scrollbars: true,
      zoom: {
        startScale: 0.65,
        controls: false,
        wheel: false,
        maxScale: 1.5,
        minScale: 0.2,
      },
    });
    editor.current = ws;
    let observer: ResizeObserver | undefined;
    try {
      const value = structuredClone(block);
      value.x = 20;
      value.y = 20;
      Blockly.serialization.workspaces.load(
        { blocks: { languageVersion: 0, blocks: [value] } },
        ws,
      );
      applyCodeVisuals(ws, { blocks: { languageVersion: 0, blocks: [value] } });
      if (typeof ResizeObserver !== "undefined") {
        observer = new ResizeObserver(() => Blockly.svgResize(ws));
        observer.observe(root.current!);
      }
      Blockly.svgResize(ws);
    } catch {
      setError(true);
    }
    return () => {
      observer?.disconnect();
      editor.current = null;
      ws.dispose();
    };
  }, [block]);
  return (
    <div>
      <div>
        <button
          aria-label="放大候选积木"
          onClick={() => editor.current?.zoomCenter(1)}
        >
          ＋
        </button>
        <button
          aria-label="缩小候选积木"
          onClick={() => editor.current?.zoomCenter(-1)}
        >
          −
        </button>
      </div>
      <div
        ref={root}
        style={{
          height: 280,
          minWidth: 240,
          position: "relative",
          opacity: 0.8,
        }}
        aria-label="只读积木画布"
      />
      {error && <p role="alert">积木预览未能绘制，请查看结构差异。</p>}
    </div>
  );
}
