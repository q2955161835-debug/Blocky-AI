import { invoke, isTauri } from "@tauri-apps/api/core";
import { encodeProject, decodeProject } from "@blocky/project-format";
import type { Project } from "@blocky/language-schema";
import { canonicalJson } from "@blocky/language-schema";
import { migrateProject } from "@blocky/project-migration";
export async function prepareMigration() {
  if (!isTauri()) throw Error("请在桌面窗口迁移项目");
  const files = await invoke<Record<string, string> | null>("open_migration");
  return files ? migrateProject(files) : null;
}
export async function saveMigration(project: Project) {
  return invoke<{ displayName: string } | null>("save_migration", {
    files: encodeProject(project),
  });
}
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
  if (!result) return null;
  try { return { ...result, project: decodeProject(result.files) }; }
  catch (error) { await releaseProject(result.handle); throw error; }
}
export async function releaseProject(handle: string | undefined) {
  if (isTauri() && handle) await invoke("release_project", { handle });
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
