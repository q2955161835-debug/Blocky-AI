import { useEffect, useRef, useState, type SetStateAction } from "react";
import {
  createSettings,
  parseSettings,
  migratePreferences,
  updateSetting,
  resetSetting,
  resolveSetting,
  type SettingsDocument,
} from "@blocky/settings-core";
import type { ProjectController } from "@blocky/project-model";
import type { Project } from "@blocky/language-schema";
import type { Preferences } from "./host";
import { readUserState, writeUserState } from "./userState";
export function useSettings(
  project: Project,
  controller: ProjectController,
  report: (message: string) => void,
) {
  const [app, setApp] = useState(() => createSettings("app"));
  const [ready, setReady] = useState(false),
    [error, setError] = useState("");
  const queue = useRef(Promise.resolve());
  useEffect(() => {
    let active = true;
    void readUserState("settings", "app")
      .then(async (raw) => {
        const document =
          raw === null
            ? migratePreferences(
                JSON.parse(localStorage.getItem("blocky.preferences") ?? "{}"),
              )
            : parseSettings(raw);
        if (document.scope !== "app") throw Error();
        if (raw === null) await writeUserState("settings", "app", document);
        if (active) {
          setApp(document);
          setReady(true);
        }
      })
      .catch(() => {
        if (active)
          setError("应用设置损坏或版本不支持。原文件保留，可选择恢复默认。");
      });
    return () => {
      active = false;
    };
  }, []);
  const projectSettings = project.settings
    ? parseSettings(project.settings)
    : createSettings("project");
  const layers = { app, project: projectSettings };
  const preferences: Preferences = {
    reduceMotion: resolveSetting("ui.reduceMotion", layers).value,
    view: resolveSetting("ui.view", layers).value,
    minimizeToTray: resolveSetting("window.minimizeToTray", layers).value,
  };
  function persist(next: SettingsDocument, defer = false) {
    if (!defer) setApp(next);
    queue.current = queue.current
      .catch(() => {})
      .then(async () => { await writeUserState("settings", "app", next); if (defer) setApp(next); });
    void queue.current.catch(() => report("应用设置未能保存，原配置仍保留。"));
  }
  const setPreferences = (action: SetStateAction<Preferences>) => {
    if (!ready) return;
    const next = typeof action === "function" ? action(preferences) : action;
    persist(
      updateSetting(
        updateSetting(
          updateSetting(app, "ui.reduceMotion", next.reduceMotion),
          "ui.view",
          next.view,
        ),
        "window.minimizeToTray",
        next.minimizeToTray,
      ),
    );
  };
  const change = (
    scope: "app" | "project",
    id: string,
    value: unknown,
    reset = false,
  ) => {
    if (!ready) throw Error("设置存储尚未就绪");
    const current = scope === "app" ? app : projectSettings;
    const next = reset
      ? resetSetting(current, id)
      : updateSetting(current, id, value);
    if (scope === "app") persist(next, id === "models.defaultResourceId");
    else
      controller.edit((p) => {
        p.manifest.settingsRef = "settings.json";
        p.settings = { ...next, scope: "project" };
      });
  };
  return {
    app,
    project: projectSettings,
    layers,
    ready,
    error,
    preferences,
    setPreferences,
    change,
    recover: () => {
      persist(createSettings("app"));
      setError("");
      setReady(true);
    },
    flush: () => queue.current,
  };
}
