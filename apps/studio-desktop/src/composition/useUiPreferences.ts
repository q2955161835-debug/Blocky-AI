import { useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { readUserState, writeUserState } from "./userState";
import {
  defaultUiPreferences,
  parseUiPreferences,
  type UiPreferenceId,
  type UiPreferences,
} from "./uiPreferences";
export function useUiPreferences(report: (text: string) => void) {
  const [values, setValues] = useState(defaultUiPreferences),
    [ready, setReady] = useState(false),
    [error, setError] = useState("");
  const queue = useRef(Promise.resolve());
  const pending = useRef(0);
  const readyRef = useRef(false);
  const reportRef = useRef(report);
  reportRef.current = report;
  useEffect(() => {
    let active = true;
    const load = async () => {
      if (pending.current) return;
      try {
        const raw = await readUserState("ui-preferences", "app");
        const doc =
          raw === null
            ? { schemaVersion: "blocky.ui-preferences/v1" as const, values: {} }
            : parseUiPreferences(raw);
        if (active && !pending.current) {
          setValues({ ...defaultUiPreferences, ...doc.values });
          setReady(true);
          readyRef.current = true;
          setError("");
        }
      } catch {
        if (active) {
          setError("外观设置无法读取，原配置保留。");
          setReady(false);
          readyRef.current = false;
        }
      }
    };
    void load();
    window.addEventListener("focus", load);
    window.addEventListener("storage", load);
    return () => {
      active = false;
      window.removeEventListener("focus", load);
      window.removeEventListener("storage", load);
    };
  }, []);
  function change<K extends UiPreferenceId>(id: K, value: UiPreferences[K]) {
    if (!readyRef.current) throw Error("外观设置尚未就绪");
    parseUiPreferences({
      schemaVersion: "blocky.ui-preferences/v1",
      values: { [id]: value },
    });
    pending.current++;
    queue.current = queue.current
      .catch(() => {})
      .then(async () => {
        try {
          let doc;
          if (isTauri())
            doc = parseUiPreferences(
              await invoke("patch_ui_preferences", { id, value }),
            );
          else {
            const raw = await readUserState("ui-preferences", "app");
            const old = raw === null ? {} : parseUiPreferences(raw).values;
            doc = parseUiPreferences({
              schemaVersion: "blocky.ui-preferences/v1",
              values: { ...old, [id]: value },
            });
            await writeUserState("ui-preferences", "app", doc);
          }
          setValues({ ...defaultUiPreferences, ...doc.values });
          setError("");
        } catch (cause) {
          setError("设置未能保存，原配置保留，请重试。");
          reportRef.current("设置未能保存，原配置保留。");
          throw cause;
        } finally {
          pending.current--;
        }
      });
    void queue.current.catch(() => {});
  }
  return { values, ready, error, change, flush: () => queue.current };
}
