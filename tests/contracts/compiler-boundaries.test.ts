import { it, expect } from "vitest";
import * as compiler from "../../packages/compiler/src/index";
import { createStarter } from "../../packages/test-fixtures/src/index";
it("does not expose invalid or cyclic edges as executable project links", async () => {
  const p = createStarter();
  p.manifest.modules[1].exports = [];
  expect((await compiler.compileProject(p)).ir.links).toEqual([]);
});
it("rejects malformed stable IDs before emitting a link", async () => {
  const p = createStarter();
  p.workspaces[
    "research-agent"
  ].blocks.blocks[0].inputs!.BODY.block!.next!.block.fields!.MODULE =
    "C:/outside";
  const result = await compiler.compileProject(p);
  expect(result.ir.links).toEqual([]);
  expect(result.diagnostics.map((d) => d.code)).toContain("BLK-TYPE-008");
});
it("rejects an export with no corresponding workspace entry", async () => {
  const p = createStarter();
  p.workspaces["citation-service"].blocks.blocks[0].fields!.EXPORT =
    "unrelated-export";
  const result = await compiler.compileProject(p);
  expect(result.ir.links).toEqual([]);
  expect(result.diagnostics.map((d) => d.code)).toContain("BLK-LINK-002");
});
it("allows independent module compilation and interaction projection consumers", async () => {
  const p = createStarter();
  const c = compiler as unknown as {
    compileWorkspace: Function;
    linkProject: Function;
    projectInteraction: Function;
  };
  const parts = p.manifest.modules.map((m) =>
    c.compileWorkspace(p.manifest.projectId, m, p.workspaces[m.moduleId]),
  );
  expect(parts[0].diagnostics).toEqual([]);
  const linked = await c.linkProject(
    p,
    parts.map((x) => x.ir),
  );
  expect(linked.ir.links).toHaveLength(1);
  const projection = c.projectInteraction(
    p,
    parts.map((x) => x.ir),
  );
  expect(projection.interaction.entries[0].interactionId).toBe("on-question");
});
