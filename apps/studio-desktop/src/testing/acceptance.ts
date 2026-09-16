import { createStarter } from "@blocky/test-fixtures";
import {
  canonicalJson,
  digest,
  type WorkspaceBlock,
} from "@blocky/language-schema";
import { compileProject, walkNodes } from "@blocky/compiler";
import { encodeProject, decodeProject } from "@blocky/project-format";
import { Runtime } from "@blocky/runtime-core";
import { Blockly } from "../../../../packages/ui-editor/src/blocks";
import { invoke } from "@tauri-apps/api/core";
import type { Studio } from "../composition/useStudio";

// This module is imported only by the native-test build, never by ordinary builds.
export function install(get: () => Studio) {
  const wait = async (condition: () => boolean) => {
    const deadline = Date.now() + 10000;
    while (!condition()) {
      if (Date.now() > deadline) throw Error("acceptance state timeout");
      await new Promise((r) => setTimeout(r, 20));
    }
  };
  const paint = () =>
    new Promise<void>((r) =>
      requestAnimationFrame(() => requestAnimationFrame(() => r())),
    );
  const workspace = () => {
    const found = Blockly.Workspace.getAll().find(
      (w) => w instanceof Blockly.WorkspaceSvg && !w.isFlyout,
    );
    if (!found) throw Error("visible Blockly workspace missing");
    return found as Blockly.WorkspaceSvg;
  };
  const fixture = () => {
    const p = createStarter();
    const nonce = crypto.randomUUID();
    p.manifest.projectId = `acceptance-${nonce}`;
    p.manifest.modules = p.manifest.modules.slice(0, 1);
    p.workspaces = {
      "research-agent": { blocks: { languageVersion: 0, blocks: [] } },
    };
    for (let stack = 0; stack < 10; stack++) {
      let next: WorkspaceBlock | undefined;
      for (let i = 7; i >= 0; i--)
        next = {
          type: "core.output.answer",
          id: `perf-output-${stack}-${i}-${nonce}`,
          fields: { STYLE: "条目" },
          ...(next ? { next: { block: next } } : {}),
        };
      p.workspaces["research-agent"].blocks.blocks.push({
        type: "core.agent",
        id: `perf-agent-${stack}-${nonce}`,
        x: 60 + stack * 380,
        y: 60,
        fields: { ROLE: `性能检查 ${stack} ${nonce}` },
        inputs: {
          BODY: {
            block: {
              type: "core.interaction.chat",
              id: `perf-chat-${stack}-${nonce}`,
              fields: { NAME: `问题 ${stack}` },
              next: { block: next! },
            },
          },
        },
      });
    }
    return p;
  };
  const ready = async () => {
    await paint();
    await wait(
      () =>
        !get().compiling &&
        !!get().compiled &&
        get().compiled!.modules[0]?.roots[0]?.fields.ROLE ===
          get().controller.getSnapshot().project.workspaces["research-agent"]
            .blocks.blocks[0].fields?.ROLE,
    );
    if (get().compiled!.diagnostics.some((d) => d.severity === "error"))
      throw Error("performance fixture compilation failed");
    await wait(() => workspace().getAllBlocks(false).length === 100);
    await wait(() => {
      const actual = workspace()
        .getAllBlocks(false)
        .map((b) => b.id)
        .sort();
      const expected = get()
        .compiled!.modules.flatMap((m) =>
          [...walkNodes(m.roots)].map(({ node }) => node.nodeId),
        )
        .sort();
      const root =
        get().controller.getSnapshot().project.workspaces["research-agent"]
          .blocks.blocks[0];
      return (
        canonicalJson(actual) === canonicalJson(expected) &&
        workspace().getBlockById(root.id)?.getFieldValue("ROLE") ===
          root.fields?.ROLE
      );
    });
  };
  const counts = () => ({
    blocks: workspace().getAllBlocks(false).length,
    nodes: get().compiled!.modules.reduce(
      (n, m) => n + [...walkNodes(m.roots)].length,
      0,
    ),
  });
  const load = async () => {
    get().controller.replace(fixture());
    get().setStarted(true);
    await ready();
    return counts();
  };
  const serialize = async () => {
    const p = structuredClone(get().controller.getSnapshot().project);
    p.workspaces["research-agent"] = Blockly.serialization.workspaces.save(
      workspace(),
    ) as (typeof p.workspaces)[string];
    const compiled = await compileProject(p);
    if (compiled.diagnostics.some((d) => d.severity === "error"))
      throw Error("serialized fixture invalid");
    return { p, compiled };
  };
  const metric = () => ({
    samplesMs: [] as number[],
    observedBlockCounts: [] as number[],
    observedNodeCounts: [] as number[],
    medianMs: 0,
  });
  let baseline = "";
  const api = {
    async performance() {
      const loadMetric = metric(),
        saveCompile = metric(),
        runtime = metric();
      for (let sample = 0; sample < 6; sample++) {
        let start = performance.now();
        const observed = await load();
        const loaded = performance.now() - start;
        start = performance.now();
        const { p, compiled } = await serialize();
        const saved = performance.now() - start;
        const kernel = new Runtime();
        start = performance.now();
        let executed = 0;
        for (const entry of compiled.interaction.entries) {
          const result = await kernel.run(p, entry.interactionId, "性能检查", {
            moduleId: entry.moduleId,
          });
          if (result.status !== "completed")
            throw Error("performance runtime failed");
          executed += result.events.filter(
            (e) => e.type === "block.started",
          ).length;
        }
        const ran = performance.now() - start;
        if (executed !== 100)
          throw Error(`expected 100 executed blocks, received ${executed}`);
        if (sample)
          for (const [m, time] of [
            [loadMetric, loaded],
            [saveCompile, saved],
            [runtime, ran],
          ] as const) {
            m.samplesMs.push(time);
            m.observedBlockCounts.push(observed.blocks);
            m.observedNodeCounts.push(observed.nodes);
          }
      }
      for (const m of [loadMetric, saveCompile, runtime])
        m.medianMs = [...m.samplesMs].sort((a, b) => a - b)[2];
      return {
        schemaVersion: "blocky.performance/v1",
        environment: {
          userAgent: navigator.userAgent,
          hardwareConcurrency: navigator.hardwareConcurrency,
          width: innerWidth,
          height: innerHeight,
          dpr: devicePixelRatio,
        },
        load: loadMetric,
        saveCompile,
        runtime,
      };
    },
    async startSoak() {
      await load();
      baseline = await digest(get().controller.getSnapshot().project);
      return { baseline, ...counts() };
    },
    async cycle(cycle: number) {
      if (!Number.isInteger(cycle) || cycle < 1 || cycle > 360)
        throw Error("invalid cycle");
      const original = get().controller.getSnapshot().project;
      get().controller.edit((p) => {
        p.workspaces["research-agent"].blocks.blocks[0].fields!.ROLE =
          `循环 ${cycle}`;
      });
      await ready();
      const changed = await digest(get().controller.getSnapshot().project);
      if (changed === baseline) throw Error("edit did not change project");
      const result = await get().run();
      if (result?.status !== "completed")
        throw Error("studio runtime did not finish");
      let roundTrip = false;
      let restoredProject: typeof original | undefined;
      if (cycle % 12 === 0) {
        const before = get().controller.getSnapshot().project;
        const files = await invoke<Record<string, string>>(
          "acceptance_round_trip",
          { files: encodeProject(before) },
        );
        const restored = decodeProject(files);
        if (canonicalJson(restored) !== canonicalJson(before))
          throw Error("native saved content differs");
        restoredProject = restored;
        roundTrip = true;
      }
      get().controller.undo();
      await ready();
      if ((await digest(get().controller.getSnapshot().project)) !== baseline)
        throw Error("undo failed");
      if (restoredProject) {
        get().controller.replace(restoredProject);
        await ready();
        if ((await digest(get().controller.getSnapshot().project)) !== changed)
          throw Error("native reload not applied");
        get().controller.replace(original);
        await ready();
      }
      const bus = get().bus;
      if (bus.records.length > 500 || get().events.length > 500)
        throw Error("unbounded event view");
      return {
        cycle,
        ...counts(),
        roundTrip,
        viewEvents: get().events.length,
        logRecords: bus.records.length,
        dropped: bus.dropped,
        droppedImportant: bus.droppedImportant,
      };
    },
  };
  (
    window as unknown as { __BLOCKY_ACCEPTANCE__?: typeof api }
  ).__BLOCKY_ACCEPTANCE__ = api;
  return () => {
    delete (window as unknown as { __BLOCKY_ACCEPTANCE__?: typeof api })
      .__BLOCKY_ACCEPTANCE__;
  };
}
