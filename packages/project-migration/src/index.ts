import {
  canonicalJson,
  diagnostic,
  digest,
  validRef,
  type Project,
  type Diagnostic,
} from "@blocky/language-schema";
import { decodeProject } from "@blocky/project-format";
import { compileProject } from "@blocky/compiler";
import { migrateSpike } from "./spike";
export type MigrationResult = {
  schemaVersion: "blocky.migration/v1";
  sourceVersion: string;
  targetVersion: "blocky.project/v1";
  sourceDigest: string;
  project?: Project;
  diagnostics: Diagnostic[];
};
export async function migrateProject(
  files: Record<string, string>,
): Promise<MigrationResult> {
  const result: MigrationResult = {
    schemaVersion: "blocky.migration/v1",
    sourceVersion: "unknown",
    targetVersion: "blocky.project/v1",
    sourceDigest: "",
    diagnostics: [],
  };
  try {
    if (
      Object.keys(files).length > 1000 ||
      new TextEncoder().encode(canonicalJson(files)).length > 8 * 1024 * 1024 ||
      Object.entries(files).some(
        ([key, value]) => !validRef(key) || typeof value !== "string",
      )
    )
      throw Error("BLK-MIG-001");
    result.sourceDigest = await digest(files);
    const source = JSON.parse(files["project.json"]);
    result.sourceVersion =
      typeof source.schemaVersion === "string"
        ? source.schemaVersion
        : "unknown";
    if (result.sourceVersion === "blocky.spike-project/v1")
      return { ...result, ...(await migrateSpike(files)) };
    if (
      !["blocky.project/v1alpha1", "blocky.project/v1"].includes(
        result.sourceVersion,
      )
    )
      throw Error("BLK-MIG-001");
    // The v1 envelope preserves all alpha facts; validation/compilation must succeed before offering a candidate.
    const project = decodeProject({
      ...files,
      "project.json": canonicalJson({
        ...source,
        schemaVersion: "blocky.project/v1",
      }),
    });
    const compiled = await compileProject(project);
    result.diagnostics = compiled.diagnostics;
    if (!result.diagnostics.some((d) => d.severity === "error"))
      result.project = project;
  } catch {
    result.diagnostics = [
      diagnostic("BLK-MIG-001", "无法迁移此版本或项目结构，原文件未修改。"),
    ];
  }
  return result;
}
