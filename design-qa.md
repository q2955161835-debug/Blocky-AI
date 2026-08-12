# Blocky canvas scrollbar design QA

- Source references: `doc/技术设计/Windows-Core视觉验收/17-scrollbar-reference-vertical.png` and `18-scrollbar-reference-horizontal.png`
- Native implementation: `doc/技术设计/Windows-Core视觉验收/19-thin-canvas-scrollbars.png`
- Viewport and state: Tauri Windows window at 1536 x 843 CSS pixels on a 125% DPI display, 100-block workspace with both canvas scrollbars visible.
- Comparison method: both source close-ups and the fresh native screenshot were inspected together at original resolution.

## Required surface review

- Scrollbar geometry: visible vertical and horizontal thumbs are 6 px thick with 3 px radii, centered inside the unchanged Blockly interaction tracks.
- Visual hierarchy: the lower-opacity slate thumb no longer competes with blocks, canvas controls, or the assistant panel.
- Interaction affordance: the larger invisible track remains intact, so the visual reduction does not reduce the pointer target.
- Layout, typography, colour tokens, copy, and imagery: unchanged outside the requested scrollbar treatment; no clipping or new overlap was observed.
## Findings

- P0: 0
- P1: 0
- P2: 0

final result: passed

## Functional regression evidence (not visual QA)

The native E2E run separately verified that discarding unsaved changes destroys the production main window. This result is a functional acceptance signal and is not part of the visual pass above.
