import { useEffect, useRef } from "react";
import * as Blockly from "blockly/core";
import * as ZhHans from "blockly/msg/zh-hans";
import type { SpikeBlockId } from "./catalog";
import { registerSpikeBlocks } from "./definitions";

export interface BlockPreviewProps {
  readonly blockType: SpikeBlockId;
}

const zhHansMessages = Object.fromEntries(
  Object.entries(ZhHans).filter((entry): entry is [string, string] =>
    typeof entry[1] === "string",
  ),
);

export function BlockPreview({ blockType }: BlockPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    Blockly.setLocale(zhHansMessages);
    registerSpikeBlocks();
    const previousMainWorkspace = Blockly.getMainWorkspace();
    const workspace = Blockly.inject(container, {
      readOnly: true,
      renderer: "geras",
      media: "./blockly-media/",
      sounds: false,
      toolbox: undefined,
      trashcan: false,
      move: {
        scrollbars: false,
        drag: false,
        wheel: false,
      },
      zoom: {
        controls: false,
        wheel: false,
        startScale: 0.78,
        minScale: 0.78,
        maxScale: 0.78,
      },
    });
    if (previousMainWorkspace) {
      Blockly.common.setMainWorkspace(previousMainWorkspace);
    }

    Blockly.Events.disable();
    try {
      const block = workspace.newBlock(blockType);
      block.initSvg();
      block.render();
      const bounds = block.getBoundingRectangle();
      block.moveBy(12 - bounds.left, 12 - bounds.top);
      container.style.height = `${Math.ceil(
        (bounds.bottom - bounds.top) * workspace.scale + 24,
      )}px`;
      Blockly.svgResize(workspace);
    } finally {
      Blockly.Events.enable();
    }

    return () => workspace.dispose();
  }, [blockType]);

  return (
    <div
      ref={containerRef}
      className="block-preview"
      aria-hidden="true"
    />
  );
}
