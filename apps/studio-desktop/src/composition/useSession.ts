import { useEffect, useRef, useState, type SetStateAction } from "react";
import {
  restoreSession,
  serializeSession,
  type Session,
} from "@blocky/project-model";
import type { Project } from "@blocky/language-schema";
import { readUserState, writeUserState } from "./userState";
export function useSession(project: Project, report: (text: string) => void) {
  const [session, rawSet] = useState(() => restoreSession(project, null));
  const [loaded, setLoaded] = useState("");
  const projectRef = useRef(project);
  projectRef.current = project;
  const touched = useRef(false),
    queue = useRef(Promise.resolve());
  const latest = useRef(session);
  latest.current = session;
  const id = project.manifest.projectId;
  const pending = useRef<
    { id: string; project: Project; session: Session } | undefined
  >(undefined);
  if (loaded === id) pending.current = { id, project, session };
  const setSession = (action: SetStateAction<Session>) => {
    touched.current = true;
    rawSet(action);
  };
  useEffect(() => {
    let active = true;
    touched.current = false;
    setLoaded("");
    rawSet(restoreSession(projectRef.current, null));
    void readUserState("session", id)
      .then((raw) => {
        if (!active) return;
        let legacy = raw;
        if (raw === null) {
          try {
            legacy = JSON.parse(
              localStorage.getItem(`blocky.session.${id}`) ?? "null",
            );
          } catch {
            report("旧会话损坏，已使用默认布局；项目内容不受影响。");
          }
        }
        const restored = restoreSession(projectRef.current, legacy);
        if (restored.diagnostics.length)
          report("部分会话目标已失效，已安全恢复可用布局。");
        if (!touched.current) rawSet(restored);
        setLoaded(id);
      })
      .catch(() => {
        if (active) {
          report("会话文件无法读取，使用默认布局；原文件保留。");
          setLoaded(`invalid:${id}`);
        }
      });
    return () => {
      active = false;
      const previous = pending.current;
      if (previous?.id === id) {
        const value = serializeSession(previous.project, previous.session);
        queue.current = queue.current
          .catch(() => {})
          .then(() => writeUserState("session", previous.id, value));
        void queue.current.catch(() => report("上一个项目的布局未能保存。"));
      }
    };
  }, [id]);
  useEffect(() => {
    if (loaded === id) rawSet((current) => restoreSession(project, current));
  }, [project]);
  const persist = () => {
    if (loaded !== id) return queue.current;
    const value = serializeSession(projectRef.current, latest.current);
    queue.current = queue.current
      .catch(() => {})
      .then(() => writeUserState("session", id, value));
    void queue.current.catch(() =>
      report("本机会话未能保存，项目内容不受影响。"),
    );
    return queue.current;
  };
  useEffect(() => {
    const timer = setTimeout(() => void persist(), 250);
    return () => clearTimeout(timer);
  }, [session, loaded, project]);
  return {
    session,
    ready: loaded === id || loaded === `invalid:${id}`,
    setSession,
    flush: persist,
    reset: () => {
      touched.current = true;
      rawSet(restoreSession(projectRef.current, null));
      setLoaded(id);
      report("已恢复默认工作台布局。");
    },
  };
}
