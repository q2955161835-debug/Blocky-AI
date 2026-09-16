import { useEffect, useMemo, useRef, useState } from "react";
import {
  emptyRegistry,
  parseRegistry,
  upsertUserResource,
} from "@blocky/resource-registry";
import { readUserState, writeUserState } from "./userState";
export function useResources(report: (text: string) => void) {
  const [registry, setRegistry] = useState(emptyRegistry),
    [ready, setReady] = useState(false),
    [error, setError] = useState("");
  const queue = useRef(Promise.resolve());
  useEffect(() => {
    let active = true;
    void readUserState("resources", "app")
      .then((raw) => {
        const doc = raw === null ? emptyRegistry() : parseRegistry(raw);
        if (active) {
          setRegistry(doc);
          setReady(true);
        }
      })
      .catch(() => {
        if (active) setError("本机资源配置无法读取，原文件保留。");
      });
    return () => {
      active = false;
    };
  }, []);
  const persist = (next: ReturnType<typeof emptyRegistry>) => {
    if (!ready) throw Error("资源存储未就绪");
    setRegistry(next);
    queue.current = queue.current
      .catch(() => {})
      .then(() => writeUserState("resources", "app", next));
    void queue.current.catch(() => report("本机资源未能保存。"));
  };
  const map = useMemo(
    () => new Map(registry.resources.map((r) => [r.resourceId, r])),
    [registry],
  );
  return {
    registry,
    map,
    ready,
    error,
    upsert: (value: unknown) => persist(upsertUserResource(registry, value)),
    remove: (id: string) =>
      persist(
        parseRegistry({
          ...registry,
          resources: registry.resources.filter((r) => r.resourceId !== id),
        }),
      ),
    flush: () => queue.current,
  };
}
