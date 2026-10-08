import { useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { startingBlueprints, type StartingBlueprintId } from "@blocky/block-catalog";

export type ProjectStarter = "blank" | StartingBlueprintId;

/** A child process receives only a built-in start ID; no project contents are copied. */
export function useProjectStartup(
  ready: boolean,
  create: (starter: ProjectStarter) => Promise<void>,
  report: (message: string) => void,
) {
  const [starter, setStarter] = useState<ProjectStarter>();
  const request = useRef<Promise<unknown>>(undefined);
  const consumed = useRef(false);
  const latest = useRef({ create, report });
  latest.current = { create, report };
  useEffect(() => {
    if (!isTauri()) return;
    let active = true;
    request.current ??= invoke("startup_project");
    void request.current.then(value => {
      if (!active || value == null) return;
      if (value === "blank" || startingBlueprints.some(item => item.id === value))
        setStarter(value as ProjectStarter);
      else latest.current.report("新作品起点无效，请从开始页重试。");
    }).catch(() => {
      if (active) latest.current.report("新作品起点未能读取，请从开始页重试。");
    });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!ready || !starter || consumed.current) return;
    consumed.current = true;
    void latest.current.create(starter);
  }, [ready, starter]);
}
