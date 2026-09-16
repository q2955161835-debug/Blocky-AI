import { decodeProject, encodeProject } from "./index";
import { digest, type Project } from "@blocky/language-schema";
export type Recovery = {
  schemaVersion: "blocky.recovery/v1";
  updatedAt: string;
  projectId: string;
  digest: string;
  files: Record<string, string>;
};
export async function createRecovery(project: Project): Promise<Recovery> {
  const files = encodeProject(project);
  return {
    schemaVersion: "blocky.recovery/v1",
    updatedAt: new Date().toISOString(),
    projectId: project.manifest.projectId,
    digest: await digest(files),
    files,
  };
}
export async function readRecovery(
  value: unknown,
): Promise<{ record: Recovery; project: Project }> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("BLK-RECOVERY-001");
  const record = value as Recovery;
  if (
    record.schemaVersion !== "blocky.recovery/v1" ||
    typeof record.updatedAt !== "string" ||
    !Number.isFinite(Date.parse(record.updatedAt)) ||
    !record.files ||
    record.digest !== (await digest(record.files))
  )
    throw Error("BLK-RECOVERY-001");
  const project = decodeProject(record.files);
  if (project.manifest.projectId !== record.projectId)
    throw Error("BLK-RECOVERY-001");
  return { record, project };
}
