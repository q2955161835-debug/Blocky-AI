import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  ProjectController,
  restoreSession,
  serializeSession,
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
import type { SourceRef, WorkspaceBlock } from "@blocky/language-schema";
import {
  openProject,
  saveProject,
  readPreferences,
  writePreferences,
} from "./host";
export function useStudio() {
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
  const [history, setHistory] = useState<SourceRef[]>([]);
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
    writePreferences(preferences);
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
  const run = async () => {
    if (
      runBusy.current ||
      compiling ||
      !compiled ||
      compiled.diagnostics.some((d) => d.severity === "error")
    )
      return;
    const entry = compiled.interaction.entries[0];
    if (!entry) {
      setMessage("请先添加收到问题积木。");
      return;
    }
    runBusy.current = true;
    setRunning(true);
    setEvents([]);
    setResult(undefined);
    abort.current = new AbortController();
    try {
      const value = await runtime.run(
        snapshot.project,
        entry.interactionId,
        question,
        {
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
    } catch {
      setMessage("无法启动运行，请检查问题面板。");
    } finally {
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
    if (
      snapshot.dirty &&
      !window.confirm("当前项目有未保存的修改，是否放弃修改并打开其他项目？")
    )
      return;
    ioBusy.current = true;
    setBusy(true);
    try {
      const opened = await openProject();
      if (opened) {
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
  const fresh = () => {
    if (runBusy.current) return;
    if (snapshot.dirty && !window.confirm("是否放弃当前未保存的修改？")) return;
    const p = createStarter();
    p.manifest.projectId = `project-${crypto.randomUUID()}`;
    controller.replace(p);
    handle.current = undefined;
    setStarted(true);
    setEvents([]);
    setResult(undefined);
    setSelected(null);
    setSession(restoreSession(p, null));
  };
  const updateField = (id: string, field: string, value: string) =>
    controller.edit((p) => {
      const block = findBlock(
        p.workspaces[session.active]?.blocks.blocks ?? [],
        id,
      );
      if (block) {
        block.fields ??= {};
        block.fields[field] = value;
      }
    });
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
    focus,
    navigate,
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
  };
}
export function findBlock(
  blocks: WorkspaceBlock[],
  id: string,
): WorkspaceBlock | undefined {
  for (const block of blocks) {
    if (block.id === id) return block;
    const child = findBlock(
      [
        ...Object.values(block.inputs ?? {}).flatMap(
          (v) => [v.block, v.shadow].filter(Boolean) as WorkspaceBlock[],
        ),
        ...(block.next ? [block.next.block] : []),
      ],
      id,
    );
    if (child) return child;
  }
}
export type Studio = ReturnType<typeof useStudio>;
