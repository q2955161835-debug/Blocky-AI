import type { Workspace, WorkspaceBlock } from "@blocky/language-schema";
import { codeState, type CodeState } from "@blocky/project-model";
import { Blockly } from "../blocks";

const labels: Record<CodeState, string> = {
  "official-default": "✓ 官方默认", "custom-valid": "✓ 已自定义", warning: "⚠ 代码警告", invalid: "✖ 代码无效",
};

/** Projection only: the label is non-serializable and the marker is a plain SVG node. */
export function applyCodeVisuals(editor: Blockly.Workspace, source: Workspace) {
  Blockly.Events.disable();
  try {
    const descriptions = new Set<Blockly.BlockSvg>();
    const visit = (block: WorkspaceBlock) => {
      if (block.type === "core.data.transform") {
        const rendered = editor.getBlockById(block.id), state = codeState(block);
        rendered?.getField("BLOCKY_CODE_STATE")?.setValue(labels[state]);
        if (rendered instanceof Blockly.BlockSvg) {
          // Blockly caches block ARIA labels when SVG is initialized. Updating a
          // non-serializable label field does not refresh it or containing values.
          for (let ancestor: Blockly.BlockSvg | null = rendered; ancestor; ancestor = ancestor.getParent())
            descriptions.add(ancestor);
          const root = rendered.getSvgRoot();
          root?.setAttribute("data-code-state", state);
          if (root && !root.querySelector(":scope > .blocky-code-marker")) {
            const marker = document.createElementNS("http://www.w3.org/2000/svg", "rect");
            marker.setAttribute("class", "blocky-code-marker");
            marker.setAttribute("x", "2"); marker.setAttribute("y", "15");
            marker.setAttribute("width", "4"); marker.setAttribute("height", "26");
            marker.setAttribute("rx", "2"); marker.setAttribute("aria-hidden", "true");
            root.appendChild(marker);
          }
        }
      }
      for (const input of Object.values(block.inputs ?? {})) {
        if (input.block) visit(input.block);
        if (input.shadow) visit(input.shadow);
      }
      if (block.next) visit(block.next.block);
    };
    source.blocks.blocks.forEach(visit);
    // Refresh after every badge has been projected, without selecting/focusing
    // blocks, changing their fields, or emitting synthetic workspace events.
    for (const block of descriptions) {
      const field = block.getFullBlockField();
      if (field) field.recomputeAriaContext();
      else Blockly.utils.aria.setState(block.getFocusableElement(), Blockly.utils.aria.State.LABEL,
        block.getAriaLabel(Blockly.utils.aria.Verbosity.STANDARD));
    }
  } finally { Blockly.Events.enable(); }
}
