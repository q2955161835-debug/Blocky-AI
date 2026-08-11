# Blocky Professional Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the current Blocky spike shell into the approved single-document productivity workbench with real file commands, reliable Blockly editing tools, and chat-driven Agent testing.

**Architecture:** Keep the current Blockly workspace → compiler → IR/manifest/tool/runtime pipeline intact. Add focused command, document-session, canvas-interaction, and conversation-projection modules around it; expose native document operations through a Rust-owned path session so the webview never sends or receives absolute file paths.

**Tech Stack:** React 19.2.8, TypeScript 7.0.2, Blockly 13.2.1, Fluent UI System Icons 2.0.316, Vitest 4.1.10, Tauri 2.11.x, Rust 1.95, `rfd` 0.17.2, `zip` 6.0.0 with only `deflate`.

## Global Constraints

- Implement [the approved second-version design](../../../doc/产品设计/Blocky-现代桌面工作区设计.md) and [L3 acceptance draft](../../../doc/验收/任务/验收-Blocky专业生产力工作台.md) exactly; do not broaden into a monorepo migration.
- No production code without a failing test first; every RED failure must be observed and recorded in the task checklist/commit history.
- Use only existing Fluent icons for visible common actions; no text-symbol, emoji, handcrafted SVG, or CSS-art icons.
- Keep `save_project` / `load_project` as the app-data recovery contract while adding a separate user-document bridge.
- The webview must never submit or receive a full native path; native open/save dialogs and the current associated path stay in Rust.
- Ordinary wheel input over the Blockly canvas zooms around the pointer; side panels keep normal scrolling.
- Sidebar collapse only resizes the visible canvas; it must preserve workspace scale, translation, block coordinates, block dimensions, and connections.
- Remove the Run button, Blockly trashcan, visible 100-block fixture command, dead runtime initial state, and all ordinary-build “Windows Core spike” copy.
- Complete with independent sub-Agent L3 acceptance, module/task/progress docs, and merge to `main` only after all required gates pass.

---

## File Structure

### New focused modules

- `src/app/commands.ts`: command IDs, menu grouping, shortcut matching, enabled state, and command search results.
- `src/app/CommandCenter.tsx`: keyboard-navigable command/block search UI.
- `src/app/DocumentSession.ts`: pure document state machine and label projection.
- `src/app/useDocumentSession.ts`: coordinates canvas snapshots, native document bridge, unsaved guard, and running-workspace replacement.
- `src/app/UnsavedChangesDialog.tsx`: one reusable Save/Discard/Cancel modal.
- `src/blockly/CanvasInteraction.ts`: pure selection/marquee/clipboard geometry and state.
- `src/blockly/CanvasToolControls.tsx`: Select/Pan tool buttons.
- `src/runtime/conversationProjection.ts`: projects runtime events into user/assistant messages and friendly trace steps.
- `src/runtime/ConversationPanel.tsx`: conversation view plus composer and collapsible execution trace.
- `src-tauri/src/document_store.rs`: `.blocky` archive validation, atomic I/O, and opaque document session.

### Existing modules to narrow

- `App.tsx`: composition only; connects controllers, commands, panels, and workspace callbacks.
- `DesktopTitleBar.tsx`: render command registry, command center, straight arrows, document status, and window controls.
- `BlocklyCanvas.tsx`: expose narrow editor commands and host `CanvasInteractionController`; no product/document logic.
- `BlockLibrary.tsx`: emit pointer-drag sessions and click insert; no workspace mutation.
- `CanvasControls.tsx`: save and zoom only.
- `useSpikeController.ts`: runtime orchestration only; document persistence moves out.
- `RuntimeComposer.tsx`: input capability/draft handling; Enter to send and Shift+Enter newline.
- `EventTimeline.tsx`: become friendly collapsible trace content without raw IDs or JSON.
- `HostBridge.ts`, `InMemoryHostBridge.ts`, `TauriHostBridge.ts`: add opaque native-document operations.
- `src-tauri/src/lib.rs`: register managed document session and dialog commands.
- `app.css`: professional shell, command popover, tools, marquee, chat, modal, and responsive/high-DPI states.

---

### Task 1: Command registry, real menus, and command center

**Files:**
- Create: `try/windows-core-spike/src/app/commands.ts`
- Create: `try/windows-core-spike/src/app/CommandCenter.tsx`
- Modify: `try/windows-core-spike/src/app/DesktopTitleBar.tsx`
- Test: `try/windows-core-spike/tests/unit/commands.test.ts`
- Test: `try/windows-core-spike/tests/component/DesktopTitleBar.test.tsx`

**Interfaces:**
- Produces: `WorkbenchCommandId`, `WorkbenchCommand`, `createWorkbenchCommands(context)`, `matchesShortcut(event, shortcut)`, `searchWorkbenchItems(query, commands, blocks)`.
- Consumes later: `CommandContext` callbacks from `App`, block items from the existing catalog, `documentLabel` from Task 3.

- [x] **Step 1: Write failing unit tests for command identity, search, and shortcut conflicts**

```ts
const commands = createWorkbenchCommands(fakeContext());
expect(Object.fromEntries(commands
  .filter((item) => item.id.startsWith("file."))
  .map((item) => [item.id, item.shortcut])))
  .toEqual({
    "file.new": "Ctrl+N",
    "file.open": "Ctrl+O",
    "file.save": "Ctrl+S",
    "file.saveAs": "Ctrl+Shift+S",
    "file.exit": "Alt+F4",
  });
expect(new Set(commands.map((item) => item.shortcut).filter(Boolean)).size)
  .toBe(commands.map((item) => item.shortcut).filter(Boolean).length);
expect(searchWorkbenchItems("聊天", commands, commandBlocks))
  .toContainEqual(expect.objectContaining({ kind: "block", blockType: "core.interaction.chat_entry" }));
```

- [x] **Step 2: Run RED test and confirm missing command module is the failure**

Run: `pnpm --dir .\try\windows-core-spike exec vitest run tests/unit/commands.test.ts`

Expected: FAIL because `src/app/commands.ts` does not exist.

- [x] **Step 3: Implement the typed command registry and search projection**

```ts
export type WorkbenchMenuId = "file" | "edit" | "view" | "help";
export type WorkbenchCommandId =
  | "file.new" | "file.open" | "file.save" | "file.saveAs" | "file.exit"
  | "edit.undo" | "edit.redo" | "edit.selectAll" | "edit.cut"
  | "edit.copy" | "edit.paste" | "edit.delete"
  | "view.toggleLeft" | "view.toggleRight" | "view.selectTool"
  | "view.panTool" | "view.zoomIn" | "view.zoomOut" | "view.resetZoom"
  | "view.fit" | "help.quickStart" | "help.shortcuts" | "help.about";

export interface WorkbenchCommand {
  readonly id: WorkbenchCommandId;
  readonly label: string;
  readonly menu: WorkbenchMenuId;
  readonly shortcut?: string;
  readonly enabled: boolean;
  readonly keywords: readonly string[];
  run(): void | Promise<void>;
}
```

Create commands from callbacks and live booleans; never keep a second hard-coded menu list in the titlebar.

- [x] **Step 4: Run unit GREEN and the existing titlebar test to expose old prop assumptions**

Run: `pnpm --dir .\try\windows-core-spike exec vitest run tests/unit/commands.test.ts tests/component/DesktopTitleBar.test.tsx`

Expected: command tests PASS; old titlebar test FAILS because it still expects hard-coded callbacks.

- [x] **Step 5: Rewrite the titlebar component test for straight arrows, command menus, and Ctrl+P search**

```tsx
expect(screen.getByRole("button", { name: "撤销" }).querySelector("svg"))
  .toHaveAttribute("data-icon-name", "ArrowLeft20Regular");
expect(screen.getByRole("button", { name: "重做" })).toBeDisabled();
await user.keyboard("{Control>}p{/Control}");
expect(screen.getByRole("combobox", { name: "搜索积木和命令" })).toHaveFocus();
await user.type(screen.getByRole("combobox"), "另存为");
await user.keyboard("{Enter}");
expect(runCommand).toHaveBeenCalledWith("file.saveAs");
```

- [x] **Step 6: Run RED and confirm the existing titlebar lacks the approved behavior**

Run: `pnpm --dir .\try\windows-core-spike exec vitest run tests/component/DesktopTitleBar.test.tsx`

Expected: FAIL on icon, disabled state, and missing command center.

- [x] **Step 7: Implement `CommandCenter` and refactor `DesktopTitleBar`**

Use `ArrowLeft20Regular`, `ArrowRight20Regular`, and `Search20Regular`. Render menu items from `commands.filter(command => command.menu === menuId)`, show shortcut labels, support ArrowUp/ArrowDown/Enter/Escape, and close after a successful command. The titlebar receives:

```ts
interface DesktopTitleBarProps {
  readonly commands: readonly WorkbenchCommand[];
  readonly blockSearchItems: readonly CommandBlockItem[];
  readonly documentLabel: string;
  readonly leftCollapsed: boolean;
  readonly rightCollapsed: boolean;
  readonly windowChrome: WindowChromeBridge;
  onRunCommand(id: WorkbenchCommandId): void;
  onInsertBlock(blockType: SpikeBlockId): void;
}
```

- [x] **Step 8: Run GREEN and commit**

Run: `pnpm --dir .\try\windows-core-spike exec vitest run tests/unit/commands.test.ts tests/component/DesktopTitleBar.test.tsx`

Commit: `feat: add real workbench commands and command center`

---

### Task 2: Native `.blocky` document archive and opaque path bridge

**Files:**
- Modify: `try/windows-core-spike/src-tauri/Cargo.toml`
- Modify: `try/windows-core-spike/src-tauri/Cargo.lock`
- Create: `try/windows-core-spike/src-tauri/src/document_store.rs`
- Modify: `try/windows-core-spike/src-tauri/src/lib.rs`
- Modify: `try/windows-core-spike/src/host/HostBridge.ts`
- Modify: `try/windows-core-spike/src/host/InMemoryHostBridge.ts`
- Modify: `try/windows-core-spike/src/host/TauriHostBridge.ts`
- Test: `try/windows-core-spike/tests/unit/documentHostBridge.test.ts`
- Test: Rust tests inside `document_store.rs`

**Interfaces:**
- Produces TS:

```ts
export interface DocumentRecord {
  readonly documentId: string;
  readonly displayName: string;
  readonly json: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly hasFileAssociation: boolean;
}
export interface SaveDocumentRequest {
  readonly json: string;
  readonly suggestedName: string;
  readonly saveAs: boolean;
}
openDocument(): Promise<DocumentRecord | null>;
saveDocument(request: SaveDocumentRequest): Promise<DocumentRecord | null>;
clearDocumentAssociation(): Promise<void>;
```

- Produces Rust commands: `open_project_document`, `save_project_document`, `clear_project_document_association`.
- Consumes: validated `blocky.spike-project/v1` JSON; keeps paths only inside `DocumentStore`.

- [x] **Step 1: Write failing TypeScript contract tests**

```ts
expect(await host.openDocument()).toBeNull();
host.queueOpen(snapshot, "weather.blocky");
expect(await host.openDocument()).toMatchObject({
  displayName: "weather.blocky", hasFileAssociation: true,
});
expect(record).not.toHaveProperty("path");
```

- [x] **Step 2: Run RED for missing HostBridge methods**

Run: `pnpm --dir .\try\windows-core-spike exec vitest run tests/unit/documentHostBridge.test.ts`

Expected: FAIL with TypeScript contract errors.

- [x] **Step 3: Extend HostBridge and implement deterministic in-memory behavior**

The in-memory bridge stores `json`, `displayName`, and a boolean association only. It exposes test helpers `queueOpen(json, displayName)` and `queueCancelOpen()` without introducing production path fields.

- [x] **Step 4: Run TypeScript GREEN**

Run: `pnpm --dir .\try\windows-core-spike exec vitest run tests/unit/documentHostBridge.test.ts tests/unit/tauriHostBridge.test.ts`

Expected: PASS.

- [x] **Step 5: Write failing Rust archive tests before adding archive code**

```rust
#[test]
fn blocky_archive_round_trips_versioned_manifest_and_project_json() {
    let bytes = encode_blocky_archive(VALID_JSON.as_bytes()).unwrap();
    assert_eq!(decode_blocky_archive(&bytes).unwrap(), VALID_JSON.as_bytes());
}

#[test]
fn blocky_archive_rejects_traversal_duplicate_and_oversized_entries() {
    for fixture in [traversal_zip(), duplicate_project_zip(), oversized_zip()] {
        assert!(decode_blocky_archive(&fixture).is_err());
    }
}
```

- [x] **Step 6: Run Rust RED**

Run: `cargo test --locked --manifest-path .\try\windows-core-spike\src-tauri\Cargo.toml document_store`

Expected: FAIL because `document_store` functions do not exist.

- [x] **Step 7: Add locked minimal dependencies**

Run from `try/windows-core-spike/src-tauri`:

```powershell
cargo add rfd@0.17.2 --no-default-features
cargo add zip@6.0.0 --no-default-features --features deflate
```

Expected: `Cargo.toml` and lockfile use exact compatible versions; no unrelated dependency upgrades.

- [x] **Step 8: Implement archive validation and atomic document storage**

```rust
pub struct DocumentStore {
    session: Mutex<DocumentSession>,
}

struct DocumentSession {
    document_id: String,
    associated_path: Option<PathBuf>,
}

pub struct DocumentRecord {
    document_id: String,
    display_name: String,
    json: String,
    sha256: String,
    bytes: u64,
    has_file_association: bool,
}
```

`decode_blocky_archive` accepts exactly two regular entries: `manifest.json` with `blocky.document/v1`, and one validated `project.json`. It rejects backslashes/absolute/traversal paths, duplicate or unknown names, encrypted/unsupported compression, malformed/ZIP64/multipart central directories, archive bytes above 5 MiB, and decompressed `project.json` above 5 MiB. `save` writes a deflated archive to a tempfile in the target directory, `sync_all`, then persists atomically. Dialog cancellation returns `Ok(None)`.

- [x] **Step 9: Register commands without adding broad capability permissions**

Manage `DocumentStore` in `tauri::Builder`, run blocking dialogs/filesystem work through `tauri::async_runtime::spawn_blocking`, and return only `DocumentRecord`. Keep the existing app-data commands unchanged.

- [x] **Step 10: Implement TauriHostBridge validation and run GREEN**

Validate returned JSON with the existing snapshot parser, rename the internal parser to accept the record identity required by app-data vs user documents, and ensure rejected payloads expose only `HostBridgeError.code` plus fixed Chinese messages.

Run:

```powershell
pnpm --dir .\try\windows-core-spike exec vitest run tests/unit/documentHostBridge.test.ts tests/unit/tauriHostBridge.test.ts
cargo test --locked --manifest-path .\try\windows-core-spike\src-tauri\Cargo.toml
```

Commit: `feat: add secure native blocky documents`

---

### Task 3: Document session state, unsaved guard, and file command lifecycle

**Files:**
- Create: `try/windows-core-spike/src/app/DocumentSession.ts`
- Create: `try/windows-core-spike/src/app/useDocumentSession.ts`
- Create: `try/windows-core-spike/src/app/UnsavedChangesDialog.tsx`
- Modify: `try/windows-core-spike/src/app/useSpikeController.ts`
- Test: `try/windows-core-spike/tests/unit/documentSession.test.ts`
- Test: `try/windows-core-spike/tests/component/useDocumentSession.test.tsx`
- Test: `try/windows-core-spike/tests/component/UnsavedChangesDialog.test.tsx`

**Interfaces:**
- Produces:

```ts
export type DocumentSaveState = "clean" | "dirty" | "saving" | "error";
export interface DocumentSessionState {
  readonly documentId: string;
  readonly displayName: string;
  readonly saveState: DocumentSaveState;
  readonly hasFileAssociation: boolean;
  readonly savedDigest: string | null;
  readonly currentDigest: string;
}
export type PendingDocumentIntent = "new" | "open" | "close" | null;
export type UnsavedDecision = "save" | "discard" | "cancel";
```

- Hook produces: `state`, `label`, `pendingIntent`, `acceptWorkspace`, `newDocument`, `openDocument`, `saveDocument`, `saveDocumentAs`, `requestClose`, `resolveUnsavedDecision`.
- Consumes: `BlocklyCanvasHandle`, `HostBridge`, `cancelRun`, `WindowChromeBridge.close` callback.

- [x] **Step 1: Write failing reducer tests for every save-state transition**

```ts
expect(createUntitledSession(EMPTY_DIGEST)).toMatchObject({
  displayName: "未命名 Agent", saveState: "dirty", hasFileAssociation: false,
});
expect(reduceDocumentSession(state, { type: "saveStarted" }).saveState).toBe("saving");
expect(reduceDocumentSession(state, { type: "saveFailed" }).saveState).toBe("error");
expect(formatDocumentLabel(saved)).toBe("weather.blocky · 已保存");
```

- [x] **Step 2: Run RED and implement pure state machine**

Run: `pnpm --dir .\try\windows-core-spike exec vitest run tests/unit/documentSession.test.ts`

Expected RED: module missing. Implement reducer with explicit actions and rerun to GREEN.

- [x] **Step 3: Write failing hook tests for new/open/save/save-as and unsaved decisions**

Test these exact cases:

```ts
await result.current.openDocument();
expect(result.current.pendingIntent).toBe("open"); // dirty guard
await result.current.resolveUnsavedDecision("cancel");
expect(canvas.load).not.toHaveBeenCalled();

await result.current.resolveUnsavedDecision("discard");
expect(canvas.load).toHaveBeenCalledWith(opened.workspace);

await result.current.saveDocument();
expect(host.saveDocument).toHaveBeenCalledWith(expect.objectContaining({ saveAs: false }));
```

- [x] **Step 4: Run hook RED**

Run: `pnpm --dir .\try\windows-core-spike exec vitest run tests/component/useDocumentSession.test.tsx`

Expected: FAIL because the hook does not exist.

- [x] **Step 5: Implement hook with one serialized replacement queue**

Before new/open, call `cancelRun()`. Set the baseline digest before `canvas.load` so its synchronous projection does not mark the opened document dirty. A failed/cancelled save must not continue a guarded action. A dialog cancellation leaves state unchanged. Keep legacy `saveProject/loadProject` in `useSpikeController` only for existing recovery/E2E APIs, but remove them from ordinary UI composition.

- [x] **Step 6: Write RED modal test and implement the modal**

```tsx
expect(screen.getByRole("dialog", { name: "保存更改？" })).toHaveTextContent("weather.blocky");
await user.click(screen.getByRole("button", { name: "取消" }));
expect(onDecision).toHaveBeenCalledWith("cancel");
```

The dialog traps focus, restores focus on close, and exposes `保存并继续`, `不保存`, `取消`.

- [x] **Step 7: Run document suite GREEN and commit**

Run:

```powershell
pnpm --dir .\try\windows-core-spike exec vitest run tests/unit/documentSession.test.ts tests/component/useDocumentSession.test.tsx tests/component/UnsavedChangesDialog.test.tsx tests/component/useSpikeController.test.tsx
```

Commit: `feat: add guarded single document lifecycle`

---

### Task 4: Reliable block pointer insertion and professional canvas tools

**Files:**
- Create: `try/windows-core-spike/src/blockly/CanvasInteraction.ts`
- Create: `try/windows-core-spike/src/blockly/CanvasToolControls.tsx`
- Modify: `try/windows-core-spike/src/blockly/BlockLibrary.tsx`
- Modify: `try/windows-core-spike/src/blockly/BlocklyCanvas.tsx`
- Modify: `try/windows-core-spike/src/blockly/blockPlacement.ts`
- Modify: `try/windows-core-spike/src/app/CanvasControls.tsx`
- Test: `try/windows-core-spike/tests/unit/canvasInteraction.test.ts`
- Test: `try/windows-core-spike/tests/component/BlockLibrary.test.tsx`
- Test: `try/windows-core-spike/tests/component/WorkbenchLayout.test.tsx`

**Interfaces:**
- Produces:

```ts
export type CanvasTool = "select" | "pan";
export interface MarqueeRect { left: number; top: number; right: number; bottom: number }
export interface CanvasInteractionState {
  readonly tool: CanvasTool;
  readonly selectedRootIds: ReadonlySet<string>;
  readonly marquee: MarqueeRect | null;
}
```

- Extends `BlocklyCanvasHandle` with: `canUndo`, `canRedo`, `setTool`, `getTool`, `selectAll`, `cutSelection`, `copySelection`, `pasteSelection`, `deleteSelection`, and `insertBlock`.
- `BlockLibrary` produces `onPointerDragStart({ blockType, pointerId, clientPoint })`; App forwards pointer moves/up to the canvas handle.

- [x] **Step 1: Write failing pure interaction tests**

```ts
expect(rectIntersects({ left: 0, top: 0, right: 20, bottom: 20 }, rootBounds)).toBe(true);
expect(toggleSelection(new Set(["a"]), "b", true)).toEqual(new Set(["a", "b"]));
expect(selectionMoveDelta(startPrimary, endPrimary)).toEqual({ dx: 24, dy: -12 });
```

Also test clipboard serialization strips IDs and keeps relative coordinates.

- [x] **Step 2: Run RED, implement pure geometry/selection helpers, rerun GREEN**

Run: `pnpm --dir .\try\windows-core-spike exec vitest run tests/unit/canvasInteraction.test.ts`

- [x] **Step 3: Replace the old HTML5 drag test with a failing pointer-session test**

```tsx
fireEvent.pointerDown(toolBlock, { pointerId: 7, clientX: 120, clientY: 240 });
expect(onPointerDragStart).toHaveBeenCalledWith({
  blockType: "core.tool.call", pointerId: 7,
  clientPoint: { clientX: 120, clientY: 240 },
});
```

Run: `pnpm --dir .\try\windows-core-spike exec vitest run tests/component/BlockLibrary.test.tsx`

Expected: FAIL because the library still emits only HTML5 drag payloads.

- [x] **Step 4: Implement pointer-session library insertion while preserving click insert**

Remove `draggable`, `BLOCKY_BLOCK_DRAG_MIME`, `onDragStart`, App `onDrop`, and App `onDragOver`. Suppress the click that follows a real drag threshold; keep ordinary click insertion unchanged.

- [x] **Step 5: Add failing Blockly behavior assertions**

Extend the component test harness/test API to assert:

```ts
expect(workspace.options.trashcan).toBe(false);
expect(workspace.options.moveOptions.wheel).toBe(false);
expect(workspace.options.zoomOptions.wheel).toBe(true);
expect(canvas.getTool()).toBe("select");
```

Add real pointer/wheel behavior to the E2E spec in Task 7, not a jsdom-only claim.

- [x] **Step 6: Implement canvas configuration and live history/zoom callbacks**

Set `trashcan: false`, `move.wheel: false`, `zoom.wheel: true`. Listen to viewport changes/wheel completion and call `onViewStateChange({ zoomPercent, canUndo, canRedo, tool, selectionCount })`. Make titlebar and zoom output read this state.

- [x] **Step 7: Implement local selection/marquee controller behind the narrow handle**

In select mode, capture blank-workspace pointer drags to render a marquee; use actual top-block bounding rectangles and intersection semantics. Shift adds/removes selection. Add `.blocky-multi-selected` only to real Blockly SVG roots. On primary selected-block release, move other selected roots by the same delta inside one Blockly event group, then repair the selected group against unselected roots as a unit. Escape clears selection.

- [x] **Step 8: Implement pan mode and temporary Space pan**

In pan mode (or while Space is held), capture pointer movement, update `scrollX/scrollY`, and call workspace `translate`; never move blocks. Restore select mode behavior on Space release. `V` and `H` switch persistent tools unless a text input is focused.

- [x] **Step 9: Implement clipboard/delete commands with Blockly serialization**

Use `Blockly.serialization.blocks.save(root, { addCoordinates: true, saveIds: false })`. Paste with `append(..., { recordUndo: true })`, preserve relative offsets, and pass the pasted group through the placement service. Delete only selected roots inside one event group. Verify undo/redo restores the entire operation.

- [x] **Step 10: Remove Run control, add tool controls, and run canvas GREEN suite**

`CanvasControls` keeps Save/−/%/+/Fit only. `CanvasToolControls` uses `Cursor20Regular` and `HandLeft20Regular` (or the closest exported Fluent hand icon verified in the installed package), with visible selected state and `V`/`H` hints.

Run:

```powershell
pnpm --dir .\try\windows-core-spike exec vitest run tests/unit/canvasInteraction.test.ts tests/unit/blockPlacement.test.ts tests/component/BlockLibrary.test.tsx tests/component/WorkbenchLayout.test.tsx
```

Commit: `feat: add professional canvas interactions`

---

### Task 5: Chat-driven testing and friendly execution trace

**Files:**
- Create: `try/windows-core-spike/src/runtime/conversationProjection.ts`
- Create: `try/windows-core-spike/src/runtime/ConversationPanel.tsx`
- Modify: `try/windows-core-spike/src/runtime/RuntimeComposer.tsx`
- Modify: `try/windows-core-spike/src/runtime/EventTimeline.tsx`
- Modify: `try/windows-core-spike/src/runtime/RuntimePanel.tsx`
- Modify: `try/windows-core-spike/src/builder/BuilderPlaceholder.tsx`
- Modify: `try/windows-core-spike/src/app/useSpikeController.ts`
- Test: `try/windows-core-spike/tests/unit/conversationProjection.test.ts`
- Test: `try/windows-core-spike/tests/component/RuntimeComposer.test.tsx`
- Test: `try/windows-core-spike/tests/component/RuntimePanel.test.tsx`

**Interfaces:**
- Produces:

```ts
export interface ConversationTurn {
  readonly runId: string;
  readonly userText: string;
  readonly assistantText: string;
  readonly status: "running" | "completed" | "cancelled" | "failed";
  readonly trace: readonly PresentedRuntimeEvent[];
}
export function projectConversationTurns(
  submissions: readonly SubmittedRuntimeInput[],
  events: readonly RuntimeEvent[],
  blockTypes: ProgramBlockTypes,
): readonly ConversationTurn[];
```

- `useSpikeController.runInput` returns `{ runId: string }` after terminal completion and records the submitted user input keyed to the emitted run ID.

- [ ] **Step 1: Write failing projection tests using real runtime events**

```ts
const turns = projectConversationTurns(submissions, events, blockTypes);
expect(turns[0]).toMatchObject({
  userText: "明天上海天气怎么样？",
  assistantText: expect.stringContaining("明天上海"),
  status: "completed",
});
expect(JSON.stringify(turns)).not.toMatch(/block-001|blocky\.event|\{"/);
```

- [ ] **Step 2: Run RED, implement pure projection, and rerun GREEN**

Run: `pnpm --dir .\try\windows-core-spike exec vitest run tests/unit/conversationProjection.test.ts`

Map `model.chunk.data.text` into one assistant message. Project trace labels from `eventPresentation`; use fixed friendly labels for run/model/tool/block terminal states and never stringify raw event data.

- [ ] **Step 3: Write failing composer keyboard tests**

```tsx
await user.type(textarea, "你好{Enter}");
expect(onSubmit).toHaveBeenCalledOnce();
await user.type(textarea, "第一行{Shift>}{Enter}{/Shift}第二行");
expect(textarea).toHaveValue("第一行\n第二行");
```

- [ ] **Step 4: Run RED and implement Enter-to-send plus Fluent send icon**

Run: `pnpm --dir .\try\windows-core-spike exec vitest run tests/component/RuntimeComposer.test.tsx`

Use `Send20Filled`, keep the draft after failed/cancelled runs, clear only after `run.completed`, and keep attachment/entry isolation.

- [ ] **Step 5: Rewrite RuntimePanel test to require conversation messages and collapsed trace**

```tsx
expect(screen.getByText("明天上海天气怎么样？")).toHaveClass("conversation-message--user");
expect(screen.getByText(/助手回复/)).toHaveClass("conversation-message--assistant");
expect(screen.getByText("执行过程")).toHaveAttribute("aria-expanded", "false");
expect(screen.queryByText("block-001")).not.toBeInTheDocument();
```

- [ ] **Step 6: Run RED and implement `ConversationPanel` / friendly trace**

Retain permission approval UI and stop button. Default trace collapsed; expanded cards use real category color plus category/action text. Rename the tab to `对话测试`.

- [ ] **Step 7: Replace technical builder placeholder with real actions**

`BuilderPlaceholder` becomes `BuilderAssistant` with callbacks:

```ts
interface BuilderAssistantProps {
  readonly hasAgent: boolean;
  readonly hasChatEntry: boolean;
  onAddAgent(): void;
  onAddChatEntry(): void;
  onOpenQuickStart(): void;
}
```

Buttons call the same canvas insertion/Help command paths; do not imply a connected AI builder model.

- [ ] **Step 8: Run runtime GREEN suite and commit**

Run:

```powershell
pnpm --dir .\try\windows-core-spike exec vitest run tests/unit/conversationProjection.test.ts tests/unit/eventPresentation.test.ts tests/component/RuntimeComposer.test.tsx tests/component/RuntimePanel.test.tsx tests/component/useSpikeController.test.tsx
```

Commit: `feat: make conversation the agent test surface`

---

### Task 6: App composition, complete product shell, and visual polish

**Files:**
- Modify: `try/windows-core-spike/src/app/App.tsx`
- Modify: `try/windows-core-spike/src/app/app.css`
- Modify: `try/windows-core-spike/src/app/WindowChromeBridge.ts`
- Modify: `try/windows-core-spike/src-tauri/tauri.conf.json`
- Modify: `try/windows-core-spike/src-tauri/Cargo.toml` package description if still user-visible in metadata
- Modify: `try/windows-core-spike/tests/component/App.test.tsx`
- Modify: `try/windows-core-spike/tests/component/App.lifecycle.test.tsx`
- Modify: `try/windows-core-spike/tests/unit/localization.test.ts`
- Modify: `try/windows-core-spike/tests/unit/spikeScope.test.ts`

**Interfaces:**
- Consumes all prior tasks.
- Produces one working single-document workbench and retains `canvasAction` only as a WDIO-injected test API, never a visible ordinary menu item.

- [ ] **Step 1: Rewrite App component tests first**

Require:

```tsx
expect(screen.getByText("未命名 Agent · 未保存")).toBeInTheDocument();
expect(screen.getByRole("tab", { name: "搭建助手" })).toHaveAttribute("aria-selected", "true");
expect(screen.getByRole("tab", { name: "对话测试" })).toBeEnabled();
expect(screen.queryByRole("button", { name: "运行" })).not.toBeInTheDocument();
expect(screen.queryByText(/Windows Core|技术尖峰|载入100块/)).not.toBeInTheDocument();
expect(document.querySelector(".blocklyTrash")).toBeNull();
```

Add a full in-memory flow: add Agent/chat blocks → send → save-as → dirty edit → new → unsaved modal cancel/discard.

- [ ] **Step 2: Run App RED**

Run: `pnpm --dir .\try\windows-core-spike exec vitest run tests/component/App.test.tsx tests/component/App.lifecycle.test.tsx`

Expected: FAIL on old static title, old runtime label, Run/trash/menu/internal copy, and missing lifecycle.

- [ ] **Step 3: Recompose App around focused controllers**

Default right tab is `builder`. Keep both panels mounted after first use so drafts survive. `对话测试` remains selectable even without an entry and shows a real `添加聊天入口` action. Build command context from document/canvas/layout/help actions. Route all library/search/builder insertions through one insertion function. Remove ordinary fixture import and visible test action; WDIO bootstrap continues through its isolated injected `canvasAction` or global test hook.

- [ ] **Step 4: Implement close guard in `WindowChromeBridge` composition**

Titlebar close and `file.exit` both call `documentSession.requestClose`, which invokes the actual bridge only after the decision flow succeeds. Keep minimize/maximize direct.

- [ ] **Step 5: Apply the approved professional visual system**

Maintain the existing dark tokens and real Blockly colors. Add exact states for command search, menu shortcuts, straight disabled arrows, tool toggle, drag preview, marquee, chat bubbles, trace accordion, save error, modal, and focus rings. Remove all Run/trash/old technical placeholder styles. Validate 1440×900 and 1180×720 without hiding core actions.

- [ ] **Step 6: Remove user-visible spike branding from Tauri metadata**

Set `productName` and window `title` to `Blocky`; use a product-facing package description while retaining internal identifier/schema versions that are required for compatibility. Update localization tests to distinguish allowed internal contract strings from forbidden rendered copy.

- [ ] **Step 7: Run component/localization GREEN and commit**

Run:

```powershell
pnpm --dir .\try\windows-core-spike exec vitest run tests/component tests/unit/localization.test.ts tests/unit/spikeScope.test.ts
pnpm --dir .\try\windows-core-spike build
```

Commit: `feat: integrate the professional Blocky workbench`

---

### Task 7: Native E2E, security gates, visual QA, and documentation

**Files:**
- Modify: `try/windows-core-spike/tests/e2e/windows-core.e2e.ts`
- Modify: `try/windows-core-spike/src/test/wdioBootstrap.ts` if the test-only fixture path needs a non-visible API
- Modify: `try/windows-core-spike/tests/unit/tauriSecurityConfig.test.ts`
- Modify: `try/windows-core-spike/tests/unit/task10PackageContract.test.ts`
- Modify: `doc/验收/模块/验收-Blocky编辑器与运行核心.md`
- Update then archive: `doc/验收/任务/验收-Blocky专业生产力工作台.md` → `doc/验收/归档/2026-08-12/`
- Create/update: `doc/进展记录/2026-08-12.md`
- Move completed plan: `docs/superpowers/plans/2026-08-12-blocky-professional-workbench.md` → `doc/归档/2026-08-12/`

**Interfaces:**
- Consumes completed product behavior.
- Produces reproducible L3 evidence tied to the final commit.

- [ ] **Step 1: Add failing E2E assertions for approved interaction paths**

Cover exact native behavior:

1. straight undo/redo states and real menus/shortcuts;
2. pointer drag from library to workspace creates at release point and does not overlap;
3. wheel over canvas changes scale but not by vertical translation; zoom label matches;
4. select/pan modes, long-drag marquee, Shift multi-select, Delete, copy/paste, undo/redo;
5. left/right collapse preserves captured view and block bounds;
6. chat send produces a user bubble, assistant bubble, collapsed color trace, and no Run button/raw IDs;
7. no `.blocklyTrash`, visible fixture command, or technical spike copy;
8. `.blocky` open/save-as cancellation and successful round-trip through a controlled native dialog fixture.

- [ ] **Step 2: Run focused E2E RED against the old/incomplete behavior**

Run:

```powershell
pnpm --dir .\try\windows-core-spike test:e2e:build
pnpm --dir .\try\windows-core-spike test:e2e
```

Expected: any remaining integration gap fails before adjustment.

- [ ] **Step 3: Fix each E2E gap through a new focused failing component/unit test first**

Do not patch production behavior directly. For every observed issue, add the smallest reproducing test, confirm RED, implement, rerun focused GREEN, then rerun E2E.

- [ ] **Step 4: Run required automated gates**

```powershell
pnpm --dir .\try\windows-core-spike check
pnpm --dir .\try\windows-core-spike check:core
cargo test --locked --manifest-path .\try\windows-core-spike\src-tauri\Cargo.toml
pnpm --dir .\try\windows-core-spike tauri build --no-bundle
pwsh -NoProfile -File .\try\windows-core-spike\tests\security\repository-sensitive-scan.ps1 -UseWdioArtifacts
git diff --check
```

Run `check:full` only if final code review confirms an event cap, save loop, WebView lifecycle, or long-lived run state changed; otherwise record the exact non-trigger rationale.

- [ ] **Step 5: Perform product-design visual comparison**

At 1440×900 and 1180×720, capture matching expanded, collapsed, command-center, marquee-selection, chat-result, and unsaved-dialog states in the user-approved browser and Windows Tauri. Put the approved reference and new screenshot into the same comparison input, fix all visible hierarchy/spacing/crop/focus defects, and repeat until clean.

- [ ] **Step 6: Request independent L3 acceptance**

Dispatch a fresh sub-Agent only for acceptance, give it the confirmed A1–A6 file and final commit, and require commands/evidence rather than implementation-context claims. Critical/Important findings return to a new RED test and fix cycle.

- [ ] **Step 7: Finalize docs after independent PASS**

Update the module baseline, fill actual commands/exit codes/hash/bytes/security scan/risks in task acceptance, archive it by date, update one precise local-time progress entry, and archive this completed plan. Record that `cargo info`/dependency resolution used the normal external Cargo cache under the user profile; no project data or secrets were stored there.

- [ ] **Step 8: Commit delivery evidence**

Commit: `docs: record professional workbench acceptance`

- [ ] **Step 9: Finish branch**

Use `superpowers:verification-before-completion`, `superpowers:requesting-code-review`, and `superpowers:finishing-a-development-branch`. After all checks and user-approved acceptance pass, merge into `main`, rerun the compact post-merge gate, delete `codex/feat-professional-workbench`, and report whether push remains pending.
