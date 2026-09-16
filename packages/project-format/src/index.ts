import {
  canonicalJson,
  validRef,
  type Project,
  type Manifest,
  type Json,
  type Workspace,
  type Resource,
} from "@blocky/language-schema";
import { parseProject } from "@blocky/project-model";
export function encodeProject(input: Project): Record<string, string> {
  const p = parseProject(input);
  const files: Record<string, string> = {
    "project.json": canonicalJson(p.manifest),
  };
  const put = (key: string, value: unknown) => {
    if (Object.hasOwn(files, key)) throw Error("BLK-REF-001");
    files[key] = canonicalJson(value);
  };
  p.manifest.modules.forEach((m) =>
    put(m.workspaceRef, p.workspaces[m.moduleId]),
  );
  p.manifest.resources
    .filter((r) => r.scope === "project")
    .forEach((r) => put(r.definitionRef, p.resources[r.resourceId]));
  Object.entries(p.schemas).forEach(([k, v]) => put(k, v));
  Object.entries(p.surfaces).forEach(([k, v]) => {
    if (k.endsWith(".json")) put(k, v);
    else {
      if (Object.hasOwn(files, k) || typeof v !== "string")
        throw Error("BLK-REF-001");
      files[k] = v;
    }
  });
  return files;
}
export function decodeProject(files: Record<string, string>): Project {
  const entries = Object.entries(files);
  if (
    entries.length > 1000 ||
    entries.some(([k, v]) => !validRef(k) || typeof v !== "string") ||
    new TextEncoder().encode(JSON.stringify(files)).length > 8 * 1024 * 1024
  )
    throw Error("BLK-REF-001");
  const get = (key: string) => {
    if (!Object.hasOwn(files, key)) throw Error("BLK-REF-001");
    return JSON.parse(files[key]);
  };
  const manifest = get("project.json") as Manifest;
  if (
    manifest.schemaVersion !== "blocky.project/v1alpha1" ||
    !Array.isArray(manifest.modules) ||
    !Array.isArray(manifest.resources)
  )
    throw Error("BLK-MIG-001");
  const workspaces: Record<string, Workspace> = {};
  const resources: Record<string, Resource> = {};
  const used = new Set(["project.json"]);
  for (const m of manifest.modules) {
    workspaces[m.moduleId] = get(m.workspaceRef);
    used.add(m.workspaceRef);
  }
  for (const r of manifest.resources)
    if (r.scope === "project") {
      resources[r.resourceId] = get(r.definitionRef);
      used.add(r.definitionRef);
    }
  const schemas: Record<string, Json> = {},
    surfaces: Record<string, Json> = {};
  for (const [key] of entries)
    if (!used.has(key)) {
      if (key.startsWith("schemas/") && key.endsWith(".json"))
        schemas[key] = get(key);
      else if (
        key.startsWith("surfaces/") &&
        manifest.appSurfaces.some((s) =>
          key.startsWith(
            s.manifestRef.slice(0, s.manifestRef.lastIndexOf("/") + 1),
          ),
        )
      )
        surfaces[key] = key.endsWith(".json") ? get(key) : files[key];
      else throw Error("BLK-REF-001: 未声明项目文件");
    }
  return parseProject({ manifest, workspaces, resources, schemas, surfaces });
}
