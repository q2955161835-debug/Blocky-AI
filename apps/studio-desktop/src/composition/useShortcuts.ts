import { useEffect, useRef, useState } from "react";
import {
  bindingsFor,
  changeBinding,
  emptyBindings,
  parseBindings,
} from "@blocky/command-system";
import { readUserState, writeUserState } from "./userState";
export function useShortcuts(report: (text: string) => void) {
  const [document, setDocument] = useState(emptyBindings),
    [ready, setReady] = useState(false),
    [error, setError] = useState("");
  const queue = useRef(Promise.resolve());
  const dirty = useRef<ReturnType<typeof emptyBindings> | undefined>(undefined);
  useEffect(() => {
    let active = true;
    void readUserState("shortcuts", "app")
      .then((raw) => {
        const doc = raw === null ? emptyBindings() : parseBindings(raw);
        if (active) {
          setDocument(doc);
          setReady(true);
        }
      })
      .catch(() => {
        if (active)
          setError("快捷键配置无法读取，暂用默认按键。可恢复默认配置。");
      });
    return () => {
      active = false;
    };
  }, []);
  const persist = (next: ReturnType<typeof emptyBindings>) => {
    setDocument(next);
    dirty.current = next;
    queue.current = queue.current
      .catch(() => {})
      .then(async () => {
        await writeUserState("shortcuts", "app", next);
        if (dirty.current === next) dirty.current = undefined;
      });
    void queue.current.catch(() => report("快捷键配置未能保存。"));
  };
  return {
    ready,
    error,
    keys: (id: string) => bindingsFor(document, id),
    exportConfig: () => JSON.stringify(document, null, 2),
    importConfig: (text: string) => {
      if (!ready) throw Error("快捷键存储尚未就绪");
      const imported = parseBindings(JSON.parse(text));
      for (const [id, keys] of Object.entries(imported.overrides)) {
        if (
          document.overrides[id] !== undefined &&
          JSON.stringify(document.overrides[id]) !== JSON.stringify(keys)
        )
          throw Error(
            "导入包含已有命令的不同绑定，请先恢复该命令默认值或清除导入中的该项。",
          );
      }
      persist(
        parseBindings({
          schemaVersion: document.schemaVersion,
          overrides: { ...document.overrides, ...imported.overrides },
        }),
      );
    },
    change: (id: string, keys: string[] | undefined) => {
      if (!ready) throw Error("快捷键存储尚未就绪");
      persist(changeBinding(document, id, keys));
    },
    recover: () => {
      persist(emptyBindings());
      setReady(true);
      setError("");
    },
    flush: async () => {
      await queue.current.catch(() => {});
      while (dirty.current) {
        const next = dirty.current;
        queue.current = queue.current.catch(() => {}).then(async () => {
          if (dirty.current === next) {
            await writeUserState("shortcuts", "app", next);
            if (dirty.current === next) dirty.current = undefined;
          }
        });
        await queue.current;
      }
    },
  };
}
