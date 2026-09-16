import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useConfirmation } from "./useConfirmation";
import {
  ProjectController,
  restoreSession,
  serializeSession,
  configureBlock,
  type Session,
} from "@blocky/project-model";
import { createStarter } from "@blocky/test-fixtures";
import { compileProject } from "@blocky/compiler";
import { Runtime, type RunResult } from "@blocky/runtime-core";
import {
  RedactedBus,
  projectLog,
  type RuntimeEvent,
} from "@blocky/observability";
import { interactionKey, type SourceRef } from "@blocky/language-schema";
import {
  openProject,
  saveProject,
  readPreferences,
  writePreferences,
} from "./host";
export function useStudio() {
  const { confirmation, answerConfirmation, confirm } = useConfirmation();
  const [controller] = useState(() => new ProjectController(createStarter()));
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
  );
  const [started, setStarted] = useState(false),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const [compiled, setCompiled] =
      useState<Awaited<ReturnType<typeof compileProject>>>(),
    [compiling, setCompiling] = useState(true);
  const [session, setSession] = useState<Session>(() =>
    restoreSession(snapshot.project, null),
  );
  const [sessionProjectId, setSessionProjectId] = useState("");
  const [preferences, setPreferences] = useState(readPreferences);
  const [selected, setSelected] = useState<string | null>(null),
    [focus, setFocus] = useState<SourceRef>();
  const [selectedRoots, setSelectedRoots] = useState<string[]>([]);
  useEffect(() => {
    setSelectedRoots([]);
  }, [session.active, snapshot.project.manifest.projectId]);
  const [history, setHistory] = useState<SourceRef[]>([]);
  const [preferredEntryId, setInteractionId] = useState("");
  const activeEntry =
    compiled?.interaction.entries.find(
      (e) => interactionKey(e) === preferredEntryId,
    ) ?? compiled?.interaction.entries[0];
  const [events, setEvents] = useState<RuntimeEvent[]>([]),
    [result, setResult] = useState<RunResult>(),
    [running, setRunning] = useState(false),
    [question, setQuestion] = useState("为什么树叶在秋天会变黄？");
  const handle = useRef<string | undefined>(undefined),
    abort = useRef<AbortController | null>(null),
    runBusy = useRef(false),
    ioBusy = useRef(false),
    sessionLoaded = useRef("");
  const [runtime] = useState(() => new Runtime({ delayMs: 160 })),
    [bus] = useState(() => new RedactedBus());
  useEffect(() => {
    let active = true;
    setCompiling(true);
    compileProject(snapshot.project)
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
  }, [snapshot.project, bus]);
  useEffect(() => {
    const id = snapshot.project.manifest.projectId;
    if (sessionLoaded.current !== id) {
      let raw: unknown;
      try {
        raw = JSON.parse(
          localStorage.getItem(`blocky.session.${id}`) ?? "null",
        );
      } catch {}
      setSession(restoreSession(snapshot.project, raw));
      setSessionProjectId(id);
      sessionLoaded.current = id;
      setHistory([]);
      setFocus(undefined);
    } else {
      setSession((current) => {
        const restored = restoreSession(snapshot.project, current);
        return {
          ...restored,
          diagnostics: restored.diagnostics.length
            ? restored.diagnostics
            : current.diagnostics,
        };
      });
    }
  }, [snapshot.project]);
  useEffect(() => {
    if (sessionProjectId === snapshot.project.manifest.projectId)
      try {
        localStorage.setItem(
          `blocky.session.${sessionProjectId}`,
          JSON.stringify(serializeSession(snapshot.project, session)),
        );
      } catch {
        setMessage("本机会话空间不足，项目内容不受影响。");
      }
  }, [session, sessionProjectId, snapshot.project]);
  useEffect(() => {
    try {
      writePreferences(preferences);
    } catch {
      setMessage("本机设置未能保存，本次会话仍可继续使用。");
    }
  }, [preferences]);
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
  const run = async (request?: {
    question: string;
    moduleId: string;
    interactionId: string;
    signal: AbortSignal;
  }) => {
    if (
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
      : activeEntry;
    if (!entry) {
      setMessage("请先添加收到问题积木。");
      return;
    }
    runBusy.current = true;
    setRunning(true);
    setEvents([]);
    setResult(undefined);
    abort.current = new AbortController();
    const controller = abort.current;
    const cancel = () => controller.abort();
    request?.signal.addEventListener("abort", cancel, { once: true });
    if (request?.signal.aborted) cancel();
    try {
      const value = await runtime.run(
        snapshot.project,
        entry.interactionId,
        request?.question ?? question,
        {
          moduleId: entry.moduleId,
          signal: abort.current.signal,
          onEvent(event) {
            setEvents((current) => [...current, event].slice(-500));
            const line = projectLog(event);
            bus.write(
              "runtime",
              line.level as "info" | "warning" | "error",
              line.summary,
              { eventSequence: event.sequence },
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
      abort.current = null;
    }
  };
  const save = async () => {
    if (ioBusy.current) return;
    ioBusy.current = true;
    setBusy(true);
    const p = controller.getSnapshot().project;
    try {
      const result = await saveProject(p, handle.current);
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
    if (ioBusy.current || runBusy.current) return;
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
        sessionLoaded.current = "";
        controller.replace(opened.project);
        handle.current = opened.handle;
        setStarted(true);
        setEvents([]);
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
  const fresh = async () => {
    if (runBusy.current || ioBusy.current) return;
    ioBusy.current = true;
    setBusy(true);
    try {
      if (
        controller.getSnapshot().dirty &&
        !(await confirm("新建项目将放弃当前未保存的修改。"))
      )
        return;
      const p = createStarter();
      p.manifest.projectId = `project-${crypto.randomUUID()}`;
      controller.replace(p);
      handle.current = undefined;
      setStarted(true);
      setEvents([]);
      setResult(undefined);
      setSelected(null);
      setSession(restoreSession(p, null));
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
  return {
    controller,
    snapshot,
    started,
    setStarted,
    message,
    setMessage,
    busy,
    compiled,
    compiling,
    session,
    setSession,
    preferences,
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
    result,
    running,
    question,
    setQuestion,
    bus,
    run,
    stop: () => abort.current?.abort(),
    save,
    open,
    fresh,
    updateField,
    interactionId: activeEntry ? interactionKey(activeEntry) : "",
    canRun:
      !busy &&
      !running &&
      !compiling &&
      !confirmation &&
      !!activeEntry &&
      !compiled?.diagnostics.some((d) => d.severity === "error"),
    diagnostics: [...(compiled?.diagnostics ?? []), ...session.diagnostics],
    setInteractionId,
    confirmation,
    answerConfirmation,
  };
}
export { findBlock } from "@blocky/project-model";
export type Studio = ReturnType<typeof useStudio>;
