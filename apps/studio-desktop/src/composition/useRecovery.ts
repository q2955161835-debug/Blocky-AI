import { useEffect, useRef, useState } from "react";
import { createRecovery, readRecovery } from "@blocky/project-format";
import { readUserState, writeUserState, clearUserState } from "./userState";
import type { Project } from "@blocky/language-schema";
export function useRecovery(
  project: Project,
  dirty: boolean,
  started: boolean,
  report: (message: string) => void,
) {
  const [candidate, setCandidate] =
    useState<Awaited<ReturnType<typeof readRecovery>>>();
  const [ready, setReady] = useState(false),
    [error, setError] = useState("");
  const queue = useRef(Promise.resolve()),
    hadRecovery = useRef(false);
  const latest = useRef({ project, dirty, started });
  latest.current = { project, dirty, started };
  useEffect(() => {
    let active = true;
    void readUserState("recovery", "latest")
      .then(async (raw) => {
        const value = raw === null ? undefined : await readRecovery(raw);
        if (active) {
          setCandidate(value);
          hadRecovery.current = !!value;
          setReady(true);
        }
      })
      .catch(() => {
        if (active) {
          setError("恢复副本损坏或版本不支持，原文件保留。可选择放弃此副本。");
          setReady(true);
        }
      });
    return () => {
      active = false;
    };
  }, []);
  const persist = () => {
    const current = latest.current;
    if (!ready || candidate || error || !current.started) return queue.current;
    queue.current = queue.current
      .catch(() => {})
      .then(async () => {
        if (current.dirty) {
          await writeUserState(
            "recovery",
            "latest",
            await createRecovery(current.project),
          );
          hadRecovery.current = true;
        } else if (hadRecovery.current) {
          await clearUserState("recovery", "latest");
          hadRecovery.current = false;
        }
      });
    void queue.current.catch(() =>
      report("恢复副本未能保存，请手动保存项目。"),
    );
    return queue.current;
  };
  useEffect(() => {
    const timer = setTimeout(() => void persist(), 500);
    return () => clearTimeout(timer);
  }, [project, dirty, started, ready, candidate, error]);
  const discard = async () => {
    await queue.current.catch(() => {});
    await clearUserState("recovery", "latest");
    hadRecovery.current = false;
    setCandidate(undefined);
    setError("");
  };
  return {
    candidate,
    ready,
    error,
    discard,
    accept: () => {
      setCandidate(undefined);
      setError("");
    },
    flush: persist,
  };
}
