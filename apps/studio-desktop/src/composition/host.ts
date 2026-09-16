import { invoke, isTauri } from "@tauri-apps/api/core";
import { encodeProject, decodeProject } from "@blocky/project-format";
import type { Project } from "@blocky/language-schema";
import { canonicalJson } from "@blocky/language-schema";
export async function validatePatch(
  project: Project,
  patch: unknown,
  approved: string[],
) {
  if (!isTauri()) throw Error("原生补丁校验不可用");
  return invoke<Project>("validate_patch", {
    originalJson: canonicalJson(project),
    patch,
    approved,
  });
}
type Opened = {
  handle: string;
  files: Record<string, string>;
  displayName: string;
};
export async function openProject() {
  if (!isTauri()) throw Error("请在 Blocky Studio 桌面窗口打开本机项目");
  const result = await invoke<Opened | null>("open_project");
  return result ? { ...result, project: decodeProject(result.files) } : null;
}
export async function saveProject(project: Project, handle?: string) {
  if (!isTauri()) throw Error("请在 Blocky Studio 桌面窗口保存本机项目");
  return invoke<{ handle: string; displayName: string } | null>(
    "save_project",
    { files: encodeProject(project), handle: handle ?? null },
  );
}
export type Preferences = {
  reduceMotion: boolean;
  view: "beginner" | "professional";
  minimizeToTray: boolean;
};
export const defaults: Preferences = {
  reduceMotion: false,
  view: "professional",
  minimizeToTray: true,
};
export function readPreferences(): Preferences {
  try {
    const value = JSON.parse(
      localStorage.getItem("blocky.preferences") ?? "{}",
    );
    return {
      reduceMotion: value.reduceMotion === true,
      view: value.view === "beginner" ? "beginner" : "professional",
      minimizeToTray: value.minimizeToTray !== false,
    };
  } catch {
    return { ...defaults };
  }
}
export function writePreferences(value: Preferences) {
  localStorage.setItem("blocky.preferences", JSON.stringify(value));
}
