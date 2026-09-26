import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useConfirmation } from "./useConfirmation";
import { useSettings } from "./useSettings";
import { useShortcuts } from "./useShortcuts";
import { useRecovery } from "./useRecovery";
import { useResources } from "./useResources";
import { useSession } from "./useSession";
import {
  ProjectController,
  restoreSession,
  configureBlock,
  editSelection,
  copyAcrossModules,
  findBlock,
  type SelectionEdit,
} from "@blocky/project-model";
import { createStarter } from "@blocky/test-fixtures";
import {
  createBlueprintProject,
  createAgentExample,
  officialStarters,
  architectureStarters,
  createArchitectureStarter,
} from "@blocky/block-catalog";
import { compileProject, IncrementalCompiler } from "@blocky/compiler";
import { Runtime, hostAdapters, type RunResult, type WorkflowSummary } from "@blocky/runtime-core";
import { knowledgeNative } from "./knowledge";
import { studioAgentServices } from "./agent";
import { studioRpaModules } from "./rpaModules";
import { studioWorkflowPorts } from "./workflow";
import { useRpaInput } from "./useRpaInput";
import {
  RedactedBus,
  projectLog,
  type RuntimeEvent,
} from "@blocky/observability";
import { digest, interactionKey, type SourceRef } from "@blocky/language-schema";
import { resolveResource } from "@blocky/resource-registry";
import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  openProject,
  saveProject,
  prepareMigration,
  saveMigration,
} from "./host";
export function useStudio() {
  const rpaInput = useRpaInput();
  const { confirmation, confirmationLabels, answerConfirmation, confirm } =
    useConfirmation();
  const [controller] = useState(() => new ProjectController(createStarter()));
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
  );
  const [started, setStarted] = useState(false),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const closing = useRef(false),
    [exiting, setExiting] = useState(false),
    [paused, setPaused] = useState(false);
  const [compiled, setCompiled] =
      useState<Awaited<ReturnType<typeof compileProject>>>(),
    [compiling, setCompiling] = useState(true);
  const sessionStore = useSession(snapshot.project, setMessage);
  const { session, setSession } = sessionStore;
  const settings = useSettings(snapshot.project, controller, setMessage);
  const shortcuts = useShortcuts(setMessage);
  const resources = useResources(setMessage);
  const workflowRegistry = useRef(resources.map);
  workflowRegistry.current = resources.map;
  const recovery = useRecovery(
    snapshot.project,
    snapshot.dirty,
    started,
    setMessage,
  );
  const { preferences, setPreferences } = settings;
  const [selected, setSelected] = useState<string | null>(null),
    [focus, setFocus] = useState<SourceRef>();
  const [selectedRoots, setSelectedRoots] = useState<string[]>([]);
  const [breakpoints, setBreakpoints] = useState<
    { moduleId: string; blockId: string }[]
  >([]);
  const toggleBreakpoint = (moduleId: string, blockId: string) =>
    setBreakpoints((current) =>
      current.some(
        (item) => item.moduleId === moduleId && item.blockId === blockId,
      )
        ? current.filter(
            (item) => item.moduleId !== moduleId || item.blockId !== blockId,
          )
        : [...current, { moduleId, blockId }],
    );
  useEffect(() => {
    setSelectedRoots([]);
  }, [session.active, snapshot.project.manifest.projectId]);
  useEffect(() => setBreakpoints([]), [snapshot.project.manifest.projectId]);
  const [history, setHistory] = useState<SourceRef[]>([]);
  const [preferredEntryId, setInteractionId] = useState("");
  const activeEntry =
    compiled?.interaction.entries.find(
      (e) => interactionKey(e) === preferredEntryId,
    ) ?? compiled?.interaction.entries[0];
  const [events, setEvents] = useState<RuntimeEvent[]>([]),
    [droppedEvents, setDroppedEvents] = useState(0),
    [result, setResult] = useState<RunResult>(),
    [running, setRunning] = useState(false),
    [question, setQuestion] = useState("为什么树叶在秋天会变黄？");
  const handle = useRef<string | undefined>(undefined),
    eventBuffer = useRef<RuntimeEvent[]>([]),
    droppedEventCount = useRef(0),
    abort = useRef<AbortController | null>(null),
    runBusy = useRef(false),
    ioBusy = useRef(false);
  const [runtime] = useState(
      () =>
        new Runtime({
          delayMs: 160,
          adapters: { ...hostAdapters(knowledgeNative, studioAgentServices(), studioRpaModules(rpaInput.request)), workflow: studioWorkflowPorts() },
        }),
    ),
    [bus] = useState(() => new RedactedBus());
  const [compiler] = useState(() => new IncrementalCompiler());
  useEffect(() => {
    let active = true;
    setCompiling(true);
    compiler
      .compile(snapshot.project, resources.map)
      .then((value) => {
        if (active) {
          setCompiled(value);
          setCompiling(false);
          bus.write(
            "compiler",
            value.diagnostics.length ? "warning" : "info",
            value.diagnostics.length
              ? `发现 ${value.diagnostics.length} 个问题`
              : "编译完成",
          );
        }
      })
      .catch(() => {
        if (active) {
          setCompiled(undefined);
          setCompiling(false);
          setMessage("项目结构无法编译，请撤销最近的修改。");
        }
      });
    return () => {
      active = false;
    };
  }, [snapshot.project, bus, compiler, resources.map]);
  useEffect(() => () => abort.current?.abort(), []);
  const navigate = (source: SourceRef, remember = true) => {
    if (
      source.projectId !== snapshot.project.manifest.projectId ||
      !source.moduleId ||
      !snapshot.project.workspaces[source.moduleId]
    )
      return;
    if (remember && session.active)
      setHistory((h) =>
        [
          ...h,
          {
            projectId: snapshot.project.manifest.projectId,
            moduleId: session.active,
            ...(selected ? { blockId: selected } : {}),
          },
        ].slice(-50),
      );
    setSession((s) => ({
      ...s,
      tabs: s.tabs.includes(source.moduleId!)
        ? s.tabs
        : [...s.tabs, source.moduleId!],
      active: source.moduleId!,
    }));
    setSelected(source.blockId ?? null);
    setFocus({ ...source });
  };
  const back = () => {
    const previous = history.at(-1);
    if (!previous) return;
    setHistory((h) => h.slice(0, -1));
    navigate(previous, false);
  };
  const openSurface = (id: string) =>
    setSession((s) => ({
      ...s,
      tabs: s.tabs.includes(`surface:${id}`)
        ? s.tabs
        : [...s.tabs, `surface:${id}`],
      active: `surface:${id}`,
    }));
  const run = async (
    request?: {
      question: string;
      moduleId: string;
      interactionId: string;
      signal: AbortSignal;
      onProgress?: (message: string) => void;
    },
    debug?: { startBlockId?: string },
    workflow?: WorkflowSummary,
  ) => {
    if (
      closing.current ||
      runBusy.current ||
      ioBusy.current ||
      compiling ||
      !compiled ||
      compiled.diagnostics.some((d) => d.severity === "error")
    )
      return;
    const entry = request
      ? compiled.interaction.entries.find(
          (e) =>
            e.moduleId === request.moduleId &&
            e.interactionId === request.interactionId,
        )
      : workflow
        ? compiled.interaction.entries.find(e =>
            workflow.projectId === snapshot.project.manifest.projectId &&
            e.moduleId === workflow.moduleId &&
            findBlock(snapshot.project.workspaces[e.moduleId]?.blocks.blocks ?? [], e.interactionId)?.inputs?.HANDLER?.block?.id === workflow.blockId)
        : activeEntry;
    if (!entry) {
      setMessage(workflow ? "工作流原入口已不存在，无法继续任务。" : "请先添加收到问题积木。");
      return;
    }
    runBusy.current = true;
    if (request) setQuestion(request.question);
    setRunning(true);
    eventBuffer.current = [];
    droppedEventCount.current = 0;
    setEvents([]);
    setDroppedEvents(0);
    setResult(undefined);
    abort.current = new AbortController();
    const controller = abort.current;
    const cancel = () => controller.abort();
    request?.signal.addEventListener("abort", cancel, { once: true });
    if (request?.signal.aborted) cancel();
    try {
      await resources.flush();
      if (isTauri()) await invoke("authorize_run");
      if (closing.current || controller.signal.aborted) throw Error();
      const value = await runtime.run(
        snapshot.project,
        entry.interactionId,
        request?.question ?? question,
        {
          moduleId: entry.moduleId,
          ...(workflow ? { workflowTaskId: workflow.taskId } : {}),
          debug: { breakpoints, ...debug },
          signal: abort.current.signal,
          userRegistry: resources.map,
          onEvent(event) {
            if (event.type === "run.paused" && event.data?.reason !== "workflow-waiting") setPaused(true);
            if (event.type === "run.resumed") setPaused(false);
            eventBuffer.current.push(event);
            if (eventBuffer.current.length > 500) {
              eventBuffer.current.shift();
              droppedEventCount.current++;
              setDroppedEvents(droppedEventCount.current);
            }
            setEvents([...eventBuffer.current]);
            const line = projectLog(event);
            request?.onProgress?.(line.summary);
            bus.write(
              "runtime",
              line.level as "info" | "warning" | "error",
              line.summary,
              { eventSequence: event.sequence },
              {
                projectId: event.projectId,
                runId: event.runId,
                moduleId: event.moduleId,
                blockId: event.blockId,
                correlationId: event.correlationId,
              },
            );
          },
        },
      );
      setResult(value);
      return value;
    } catch {
      setMessage("无法启动运行，请检查问题面板。");
    } finally {
      request?.signal.removeEventListener("abort", cancel);
      runBusy.current = false;
      setRunning(false);
      setPaused(false);
      abort.current = null;
    }
  };
  const save = async (asNew = false) => {
    if (ioBusy.current) return;
    ioBusy.current = true;
    setBusy(true);
    const p = controller.getSnapshot().project;
    try {
      const result = await saveProject(p, asNew ? undefined : handle.current);
      if (result) {
        handle.current = result.handle;
        controller.markSaved(p);
        setMessage("项目已保存");
        bus.write("host", "info", "项目已保存");
      }
    } catch {
      setMessage("保存失败，原文件保持不变。");
      bus.write("host", "error", "项目保存失败");
    } finally {
      ioBusy.current = false;
      setBusy(false);
    }
  };
  const open = async () => {
    if (closing.current || ioBusy.current || runBusy.current) return;
    ioBusy.current = true;
    setBusy(true);
    try {
      if (
        controller.getSnapshot().dirty &&
        !(await confirm(
          "当前项目有未保存的修改。继续打开其他项目将放弃这些修改。",
        ))
      )
        return;
      const revision = controller.getSnapshot().revision;
      const opened = await openProject();
      if (opened) {
        if (
          controller.getSnapshot().revision !== revision &&
          controller.getSnapshot().dirty &&
          !(await confirm(
            "选择文件期间当前项目发生了新修改。继续打开将放弃这些修改。",
          ))
        )
          return;
        controller.replace(opened.project);
        handle.current = opened.handle;
        setStarted(true);
        eventBuffer.current = [];
        droppedEventCount.current = 0;
        setEvents([]);
        setDroppedEvents(0);
        setResult(undefined);
        setSelected(null);
        setMessage("已打开项目并重新编译");
      }
    } catch {
      setMessage("无法打开：项目损坏、版本不支持或包含未声明文件。");
    } finally {
      ioBusy.current = false;
      setBusy(false);
    }
  };
  const startBlueprint = async (starterId: string) => {
    if (closing.current || runBusy.current || ioBusy.current) return;
    ioBusy.current = true;
    setBusy(true);
    try {
      if (
        controller.getSnapshot().dirty &&
        !(await confirm("新建项目将放弃当前未保存的修改。"))
      )
        return;
      const p =
        starterId === "agent-loop"
          ? createAgentExample()
          : architectureStarters.some((s) => s.id === starterId)
            ? createArchitectureStarter(starterId)
            : await createBlueprintProject(starterId);
      controller.replace(p);
      handle.current = undefined;
      setStarted(true);
      eventBuffer.current = [];
      droppedEventCount.current = 0;
      setEvents([]);
      setDroppedEvents(0);
      setResult(undefined);
      setSelected(null);
      setSession(restoreSession(p, null));
      setQuestion(
        starterId === "agent-loop"
          ? "Hello Blocky\n一起学习"
          : ([...officialStarters, ...architectureStarters].find(
              (s) => s.id === starterId,
            )?.sampleInput ?? ""),
      );
    } catch {
      setMessage("蓝图无法创建，请检查公开插槽和本机配置。");
    } finally {
      ioBusy.current = false;
      setBusy(false);
    }
  };
  const fresh = () => startBlueprint("research-companion");
  const migrate = async () => {
    if (closing.current || runBusy.current || ioBusy.current) return;
    ioBusy.current = true;
    setBusy(true);
    try {
      const migration = await prepareMigration();
      if (!migration) return;
      if (!migration.project) {
        setMessage(
          migration.diagnostics
            .map(
              (d) =>
                `${d.code}：${d.message}${d.source?.blockId ? `（${d.source.blockId}）` : ""}`,
            )
            .join("；"),
        );
        return;
      }
      if (
        !(await confirm(
          `将旧作品迁移为新文件，保留 ${migration.project.manifest.modules.length} 个画布和原始文件。当前打开的作品不会改变。`,
        ))
      )
        return;
      const saved = await saveMigration(migration.project);
      if (saved)
        setMessage(
          `已迁移为 ${saved.displayName}，可通过打开项目查看。原文件未修改。`,
        );
    } catch {
      setMessage(
        "迁移未写入：请选择尚不存在的新文件名，并检查源文件版本与内容。原项目保留。",
      );
    } finally {
      ioBusy.current = false;
      setBusy(false);
    }
  };
  const updateField = (id: string, field: string, value: string) => {
    try {
      controller.edit((p) => {
        configureBlock(p, session.active, id, field, value);
      });
    } catch {
      setMessage("此配置值无效或超出长度限制，原配置保持不变。");
    }
  };
  const applySelectionEdit = (edit: SelectionEdit) => {
    try {
      controller.edit((p) => {
        const workspace = p.workspaces[session.active];
        if (!workspace) throw Error("BLK-EDIT-001");
        editSelection(workspace, selectedRoots, edit);
      });
    } catch {
      setMessage("所选积木无法执行此编辑，项目保持不变。");
    }
  };
  const copySelectionToModule = (targetModuleId: string) => {
    try {
      controller.edit((p) => {
        copyAcrossModules(
          p,
          session.active,
          targetModuleId,
          selectedRoots,
          () => `block-${crypto.randomUUID()}`,
        );
      });
      setMessage("已复制到目标画布，可撤销。");
    } catch {
      setMessage("跨画布复制未完成，请检查目标画布和所选积木。");
    }
  };
  const settle = async () => {
    closing.current = true;
    setExiting(true);
    answerConfirmation(false);
    abort.current?.abort();
    runtime.resume();
    await settings.flush();
    await shortcuts.flush();
    await recovery.flush();
    await resources.flush();
    await sessionStore.flush();
    const until = Date.now() + 5000;
    while (runBusy.current || ioBusy.current) {
      if (Date.now() > until) throw Error("BLK-WINDOW-001");
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  };
  const togglePause = () => {
    if (!running) return;
    if (paused) {
      runtime.resume();
      setPaused(false);
    } else {
      runtime.pause();
      setPaused(true);
    }
  };
  return {
    rpaInput,
    controller,
    migrate,
    confirm,
    snapshot,
    started,
    setStarted,
    message,
    setMessage,
    busy,
    exiting,
    settle,
    paused,
    togglePause,
    step: () => {
      if (running && paused) {
        runtime.step();
        setPaused(false);
      }
    },
    breakpoints,
    toggleBreakpoint,
    runFromSelected: (blockId?: string) =>
      (blockId ?? selected) && session.active
        ? run(undefined, { startBlockId: (blockId ?? selected)! })
        : undefined,
    compiled,
    compiling,
    session,
    setSession,
    preferences,
    settings,
    shortcuts,
    resources,
    resetLayout: sessionStore.reset,
    recovery,
    restoreRecovery: () => {
      if (!recovery.candidate || running || busy) return;
      handle.current = undefined;
      controller.recover(recovery.candidate.project);
      recovery.accept();
      setStarted(true);
      setMessage("已恢复未保存副本。保存时请选择新文件；尚未启动运行或终端。");
    },
    setPreferences,
    selected,
    setSelected,
    selectedRoots,
    setSelectedRoots,
    focus,
    navigate,
    openSurface,
    back,
    canGoBack: history.length > 0,
    events,
    droppedEvents,
    result,
    invalidateKnowledgeEvidence: () => {
      abort.current?.abort();
      setResult(undefined);
    },
    running,
    question,
    setQuestion,
    bus,
    run,
    resumeWorkflow: (task: WorkflowSummary) => run(undefined, undefined, task),
    validateWorkflow: async (task: WorkflowSummary) => {
      const current = controller.getSnapshot(), registry = workflowRegistry.current;
      const project = current.project;
      const resolved = project.manifest.resources.map(reference => resolveResource(project, reference.resourceId, reference.kind, registry));
      const planDigest = await digest({project, resources:resolved});
      if (project.manifest.projectId !== task.projectId || planDigest !== task.planDigest ||
        controller.getSnapshot().revision !== current.revision || workflowRegistry.current !== registry)
        throw Error("BLK-WORKFLOW-BINDING");
    },
    stop: () => abort.current?.abort(),
    save,
    open,
    fresh,
    startBlueprint,
    updateField,
    applySelectionEdit,
    copySelectionToModule,
    interactionId: activeEntry ? interactionKey(activeEntry) : "",
    canRun:
      !exiting &&
      !busy &&
      !running &&
      !compiling &&
      !confirmation &&
      !!activeEntry &&
      !compiled?.diagnostics.some((d) => d.severity === "error"),
    diagnostics: [...(compiled?.diagnostics ?? []), ...session.diagnostics],
    setInteractionId,
    confirmation,
    confirmationLabels,
    answerConfirmation,
  };
}
export { findBlock } from "@blocky/project-model";
export type Studio = ReturnType<typeof useStudio>;
