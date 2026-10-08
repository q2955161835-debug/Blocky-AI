import { useEffect, useMemo, useRef, useState } from "react";
import {
  emptyRegistry,
  parseRegistry,
  upsertUserResource,
  upsertModelProvider,
  removeModelProvider,
  resolveRegistryResources,
} from "@blocky/resource-registry";
import { readUserState, writeUserState } from "./userState";
export function useResources(report: (text: string) => void) {
  const [registry, setRegistry] = useState(emptyRegistry),
    [ready, setReady] = useState(false),
    [error, setError] = useState("");
  const queue = useRef(Promise.resolve());
  const current = useRef(registry);
  useEffect(() => {
    let active = true;
    void readUserState("resources", "app")
      .then((raw) => {
        const doc = raw === null ? emptyRegistry() : parseRegistry(raw);
        if (active) {
          setRegistry(doc);
          current.current = doc;
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
  useEffect(() => {
    let active = true;
    const refresh = () => {
      void queue.current.catch(() => {}).then(async () => {
        const raw = await readUserState("resources", "app");
        const fresh = raw === null ? emptyRegistry() : parseRegistry(raw);
        if (active && fresh.revision !== current.current.revision) {
          current.current = fresh;
          setRegistry(fresh);
        }
      }).catch(() => {});
    };
    window.addEventListener("focus", refresh);
    return () => { active = false; window.removeEventListener("focus", refresh); };
  }, []);
  const persist = (mutate: (doc: ReturnType<typeof emptyRegistry>) => ReturnType<typeof emptyRegistry>) => {
    if (!ready) throw Error("资源存储未就绪");
    const operation = queue.current
      .catch(() => {})
      .then(async () => {
        try {
          const next = mutate(current.current);
          await writeUserState("resources", "app", next);
          current.current = next;
          setRegistry(next);
          setError("");
        } catch (cause) {
          const conflict = String(cause).includes("BLK-RESOURCE-CONFLICT");
          if (conflict) {
            const raw = await readUserState("resources", "app");
            const fresh = raw === null ? emptyRegistry() : parseRegistry(raw);
            current.current = fresh;
            setRegistry(fresh);
          }
          report(conflict ? "资源已被其他写入修改；草稿保留，请审查后重试。" : "本机资源未能保存，原配置保留。");
          throw conflict ? Error("BLK-RESOURCE-CONFLICT") : cause;
        }
      });
    // Callers still receive the failure, but the registry remains committed.
    // Draining cannot replay a rejected mutation (especially a revision conflict).
    queue.current = operation.catch(() => {});
    // Callers can await/reject the original promise; also avoid unhandled rejection for old fire-and-forget consumers.
    void operation.catch(() => {});
    return operation;
  };
  const map = useMemo(
    () => resolveRegistryResources(registry),
    [registry],
  );
  return {
    registry,
    map,
    ready,
    error,
    upsert: (value: unknown) => { const input=structuredClone(value); return persist(doc => upsertUserResource(doc, input)); },
    upsertProvider: (value: unknown) => { const input=structuredClone(value); return persist(doc => upsertModelProvider(doc, input)); },
    removeProvider: (id: string) => persist(doc => removeModelProvider(doc, id)),
    remove: (id: string) =>
      persist(
        doc => parseRegistry({
          ...doc,
          revision: doc.revision + 1,
          resources: doc.resources.filter((r) => r.resourceId !== id),
        }),
      ),
    flush: () => queue.current,
  };
}
