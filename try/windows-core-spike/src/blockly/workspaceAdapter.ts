import * as Blockly from "blockly/core";
import type { JsonValue } from "../core/json";

export function saveWorkspace(workspace: Blockly.Workspace): JsonValue {
  return Blockly.serialization.workspaces.save(workspace) as JsonValue;
}

export function loadWorkspace(
  state: JsonValue,
  workspace: Blockly.Workspace,
): void {
  Blockly.serialization.workspaces.load(
    state as { [key: string]: unknown },
    workspace,
  );
}

export function listWorkspaceBlockIds(workspace: Blockly.Workspace): string[] {
  return workspace.getAllBlocks(false).map((block) => block.id);
}
