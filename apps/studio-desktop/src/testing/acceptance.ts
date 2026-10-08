import { createAgentExample, createArchitectureStarter } from "@blocky/test-fixtures/scenarios";
import { createStarter, createParallelProject } from "@blocky/test-fixtures";
import { restoreSession } from "@blocky/project-model";
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
import { draftSurface, draftGeneratedSurface } from "@blocky/app-surface";
import { makePatch, applyPatch } from "@blocky/builder-protocol";
import { validatePatch } from "../composition/host";

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
  const findWorkspace = () => Blockly.Workspace.getAll().find(
      (w) => w instanceof Blockly.WorkspaceSvg && !w.isFlyout,
    ) as Blockly.WorkspaceSvg | undefined;
  const workspace = () => {
    const found = findWorkspace();
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
        get().sessionReady && !get().compiling && !!findWorkspace() &&
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
  let baselineProject: ReturnType<typeof fixture>;
  const differencePaths = (a: unknown, b: unknown, path = ""): string[] => {
    if (a === undefined || b === undefined) return a === b ? [] : [path];
    if (canonicalJson(a) === canonicalJson(b)) return [];
    if (!a || !b || typeof a !== "object" || typeof b !== "object")
      return [path];
    const left = a as Record<string, unknown>,
      right = b as Record<string, unknown>;
    return [...new Set([...Object.keys(left), ...Object.keys(right)])]
      .flatMap((key) =>
        differencePaths(left[key], right[key], `${path}/${key}`),
      )
      .slice(0, 30);
  };
  const api = {
    async loadParallelProject() {
      get().controller.replace(createParallelProject());
      get().setSession(restoreSession(get().controller.getSnapshot().project, null));
      get().setStarted(true);
      await wait(() => get().sessionReady && !!get().compiled?.interaction.entries.some(e => e.interactionId === "on-parallel") && !!findWorkspace()?.getBlockById("parallel"));
      return { canRun: get().compiled?.diagnostics.every(d => d.severity !== "error") };
    },
    async diagnosticScopeState() {
      const stored = await invoke<{
        records: { scope?: { runId?: string; blockId?: string } }[];
      }>("read_diagnostics", { channel: "runtime" });
      const runId = get().events[0]?.runId;
      return {
        runId,
        storedForRun: stored.records.filter(
          (record) => record.scope?.runId === runId,
        ).length,
        blocksForRun: stored.records.filter(
          (record) => record.scope?.runId === runId && record.scope?.blockId,
        ).length,
      };
    },
    async loadCodeStateProject() {
      const project = createStarter();
      project.manifest.modules = project.manifest.modules.slice(0, 1);
      const program = {
        schemaVersion: "blocky.expression/v1",
        parameters: ["x"],
        expression: { parameter: "x" },
      };
      project.workspaces = {
        "research-agent": {
          blocks: {
            languageVersion: 0,
            blocks: [
              {
                type: "core.data.transform",
                id: "code-official",
                x: 60,
                y: 30,
                fields: { NAME: "默认计算", PROGRAM: program },
              },
              {
                type: "core.data.transform",
                id: "code-custom",
                x: 60,
                y: 165,
                fields: { NAME: "自定义计算", PROGRAM: program },
                data: '{"schemaVersion":"blocky.editor/v1","codeEdited":true}',
              },
              {
                type: "core.data.transform",
                id: "code-warning",
                x: 60,
                y: 300,
                fields: {
                  NAME: "附带源码说明",
                  PROGRAM: program,
                  SOURCE: "legacy source",
                },
              },
              {
                type: "core.data.transform",
                id: "code-invalid",
                x: 60,
                y: 435,
                fields: {
                  NAME: "无效表达式",
                  PROGRAM: { schemaVersion: "invalid" },
                },
              },
            ],
          },
        },
      };
      get().controller.replace(project);
      get().setSession(restoreSession(project, null));
      get().setStarted(true);
      await paint();
      await wait(
        () => get().sessionReady && !get().compiling && findWorkspace()?.getAllBlocks(false).length === 4,
      );
      workspace().setScale(0.65);
      workspace().scroll(0, 0);
      await paint();
      return {
        digest: await digest(get().controller.getSnapshot().project),
        canRun: get().canRun,
        invalid: get().compiled?.diagnostics.some(
          (item) => item.code === "BLK-EXPR-001",
        ),
      };
    },
    async overviewState() {
      const ws = workspace();
      return {
        digest: await digest(get().controller.getSnapshot().project),
        viewport: ws.getMetricsManager().getViewMetrics(true),
      };
    },
    async loadAgentSemanticsProject() {
      const project = createAgentExample("stage4-native-semantics");
      // Pure language fixture. Actual Host approval/tool UI is separately tested in the ordinary candidate.
      const body =
        project.workspaces["research-agent"].blocks.blocks[0].inputs!.BODY
          .block!;
      body.next = {
        block: {
          type: "core.logic.condition",
          id: "native-condition",
          fields: { SOURCE: "input", OP: "equals", VALUE: "yes" },
          inputs: {
            THEN: {
              block: {
                type: "core.data.set",
                id: "native-yes",
                fields: { VALUE: '{"ok":true}' },
              },
            },
            ELSE: {
              block: {
                type: "core.data.set",
                id: "native-no",
                fields: { VALUE: '{"ok":false}' },
              },
            },
          },
          next: {
            block: {
              type: "core.output.structured",
              id: "native-output",
              fields: { SCHEMA: "schemas/native-result.json" },
            },
          },
        },
      };
      project.schemas["schemas/native-result.json"] = {
        type: "object",
        properties: { ok: { type: "boolean" } },
        required: ["ok"],
        additionalProperties: false,
      };
      get().controller.replace(project);
      get().setSession(restoreSession(project, null));
      get().setQuestion("yes");
      get().setStarted(true);
      await paint();
      await wait(() => !get().compiling && get().canRun);
      const files = encodeProject(project);
      const restored = await invoke<Record<string, string>>(
        "acceptance_round_trip",
        { files },
      );
      return {
        same:
          canonicalJson(encodeProject(decodeProject(restored))) ===
          canonicalJson(files),
        minimumReaderVersion: project.manifest.format.minimumReaderVersion,
      };
    },
    async loadStateMachineRegressionProject() {
      const project = createArchitectureStarter("state-machine");
      get().controller.replace(project);
      get().setSession(restoreSession(project, null));
      get().setStarted(true);
      await paint();
      await wait(() => !get().compiling && get().canRun);
    },
    async loadLegacyRegressionProject() {
      const project = createStarter();
      get().controller.replace(project);
      get().setSession(restoreSession(project, null));
      get().setQuestion("为什么树叶在秋天会变黄？");
      get().setStarted(true);
      await paint();
      await wait(() => !get().compiling && get().canRun);
    },
    async loadSurfaceRegressionProject(generated = false) {
      const project = createStarter();
      get().controller.replace(project);
      get().setSession(restoreSession(project, null));
      get().setStarted(true);
      await paint();
      await wait(() => !get().compiling);
      const spec = {
        schemaVersion: "blocky.surface-spec/v1",
        title: "学习资料查询",
        description: "填写问题并附加课堂笔记",
        layout: "split",
        submitLabel: "查询资料",
        resultLabel: "资料回答",
        attachment: true,
        confirmation: true,
        fields: [
          {
            id: "question",
            label: "问题",
            type: "textarea",
            required: true,
            options: [],
          },
        ],
      };
      const draft = generated
        ? await draftGeneratedSurface(
            project,
            "research-agent",
            "explicit-user-command",
            spec,
          )
        : await draftSurface(
            project,
            "research-agent",
            "explicit-user-command",
          );
      const patch = await makePatch(project, [
        { op: "app-surface.add", ...draft },
      ]);
      await applyPatch(
        get().controller,
        patch,
        patch.permissionDelta,
        validatePatch,
      );
      get().openSurface(draft.manifest.surfaceId);
      await paint();
      await wait(() => !get().compiling);
      const files = encodeProject(get().controller.getSnapshot().project),
        restored = await invoke<Record<string, string>>(
          "acceptance_round_trip",
          { files },
        );
      return {
        surfaceId: draft.manifest.surfaceId,
        same: canonicalJson(files) === canonicalJson(restored),
      };
    },
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
      baselineProject = structuredClone(get().controller.getSnapshot().project);
      baseline = await digest(get().controller.getSnapshot().project);
      return { baseline, ...counts() };
    },
    async hiddenRunProbe() {
      await api.startSoak();
      await invoke("hide_window");
      const result = await get().run();
      return {
        status: result?.status ?? "not-started",
        hostAllowsNewRun: await api.windowAllowsRun(),
      };
    },
    async windowAllowsRun() {
      return invoke("authorize_run").then(
        () => true,
        () => false,
      );
    },
    async restoreWindow() { await invoke("acceptance_restore_window"); },
    async cycle(cycle: number) {
      if (!Number.isInteger(cycle) || cycle < 1 || cycle > 360)
        throw Error("invalid cycle");
      const original = get().controller.getSnapshot().project;
      if ((await digest(original)) !== baseline)
        throw Error(
          `baseline changed before cycle ${cycle}: ${JSON.stringify(differencePaths(baselineProject, original))}`,
        );
      get().controller.edit((p) => {
        p.workspaces["research-agent"].blocks.blocks[0].fields!.ROLE =
          `循环 ${cycle}`;
      });
      await ready();
      const editedRevision = get().controller.getSnapshot().revision;
      const changed = await digest(get().controller.getSnapshot().project);
      if (changed === baseline) throw Error("edit did not change project");
      const result = await get().run();
      if (result?.status !== "completed") {
        const hostAllowsNewRun = await invoke("authorize_run").then(
          () => true,
          () => false,
        );
        const state = get();
        throw Error(
          `studio runtime did not finish: ${JSON.stringify({
            cycle,
            status: result?.status ?? "not-started",
            hostAllowsNewRun,
            visibility: document.visibilityState,
            focused: document.hasFocus(),
            compiling: state.compiling,
            compiled: !!state.compiled,
            canRun: state.canRun,
            running: state.running,
            busy: state.busy,
            exiting: state.exiting,
            editedRevision,
            renderedRevision: state.snapshot.revision,
            controllerRevision: state.controller.getSnapshot().revision,
            paths: differencePaths(
              baselineProject,
              state.controller.getSnapshot().project,
            ),
          })}`,
        );
      }
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
      const beforeUndoRevision = get().controller.getSnapshot().revision;
      get().controller.undo();
      await ready();
      if ((await digest(get().controller.getSnapshot().project)) !== baseline)
        throw Error(
          `undo failed: ${JSON.stringify({ cycle, editedRevision, beforeUndoRevision, afterUndoRevision: get().controller.getSnapshot().revision, paths: differencePaths(baselineProject, get().controller.getSnapshot().project) })}`,
        );
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
