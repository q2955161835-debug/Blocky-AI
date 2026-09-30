// @vitest-environment jsdom
import { expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach } from "vitest";
import { createAgentExample } from "../../packages/block-catalog/src";
import { createStarter } from "../../packages/test-fixtures/src";
import type { WorkspaceBlock } from "../../packages/language-schema/src";
import { Inspector } from "../../apps/studio-desktop/src/app/Inspector";
import type { Studio } from "../../apps/studio-desktop/src/composition/useStudio";

function findBlock(root: WorkspaceBlock, id: string): WorkspaceBlock | undefined {
  if (root.id === id) return root;
  for (const input of Object.values(root.inputs ?? {})) {
    const found = input.block && findBlock(input.block, id);
    if (found) return found;
  }
  return root.next?.block && findBlock(root.next.block, id);
}

afterEach(cleanup);

it.each([
  ["core.model.compose", "agent-model"],
  ["core.reason.tool_loop", "agent-model"],
  ["core.knowledge.retrieve", "product-handbook"],
  ["core.tool.invoke", "text-tool"],
  ["core.tool.expose", "text-tool"],
])("selects only %s resources in its declared kind", (type, expectedId) => {
  const project = createAgentExample("resource-selector-project");
  const starter = createStarter();
  const knowledgeRef = starter.manifest.resources.find((item) => item.kind === "knowledge")!;
  project.manifest.resources.push(knowledgeRef);
  project.resources[knowledgeRef.resourceId] = starter.resources[knowledgeRef.resourceId];
  const selected = findBlock(project.workspaces["research-agent"].blocks.blocks[0], "compose-answer")!;
  selected.type = type;
  selected.fields = { RESOURCE: expectedId };
  const studio = {
    selected: selected.id,
    session: { active: "research-agent" },
    snapshot: { project },
    resources: { map: new Map() },
    updateField: () => {},
  } as unknown as Studio;

  render(<Inspector studio={studio} />);
  const select = screen.getByLabelText("资源") as HTMLSelectElement;
  expect(Array.from(select.options).map((option) => option.value)).toEqual(["", expectedId]);
});
