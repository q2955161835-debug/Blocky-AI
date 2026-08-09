import { invoke } from "@tauri-apps/api/core";
import { z } from "zod";
import { compileWorkspace } from "../core/compileWorkspace";
import { compileInteractionManifest } from "../core/interactionManifest";
import type { BlockyProgram, IrNode } from "../core/ir";
import { stableStringify, type JsonValue } from "../core/json";
import { scanSensitiveValues } from "../core/securityScan";
import type { SpikeProjectSnapshot } from "../project/SpikeProjectSnapshot";
import type { HostBridge, SaveProjectRequest } from "./HostBridge";

export interface ProjectRecord {
  readonly projectId: string;
  readonly json: string;
  readonly sha256: string;
  readonly bytes: number;
}

interface NativeSaveProjectRequest {
  readonly projectId: string;
  readonly json: string;
}

export class HostBridgeError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "HostBridgeError";
  }
}

const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

const irNodeSchema: z.ZodType<IrNode> = z.lazy(() =>
  z.strictObject({
    id: z.string(),
    type: z.string(),
    fields: z.record(z.string(), jsonValueSchema).optional(),
    inputs: z.record(z.string(), irNodeSchema).optional(),
    next: irNodeSchema.optional(),
  }),
);

const programSchema: z.ZodType<BlockyProgram> = z.strictObject({
  schemaVersion: z.literal("blocky.ir/v0-spike"),
  roots: z.array(irNodeSchema),
});

const interactionEntrySchema = z.strictObject({
  id: z.string(),
  ownerAgentId: z.string(),
  displayName: z.string(),
  acceptedParts: z.array(z.enum(["text", "image", "file", "voice"])),
  exposedSkills: z.array(z.string()),
  exposedPluginActions: z.array(z.string()),
  executionRequirements: z.array(z.string()),
});

const interactionManifestSchema = z.strictObject({
  schemaVersion: z.literal("blocky.interaction/v0-spike"),
  entries: z.array(interactionEntrySchema),
});

const snapshotSchema = z.strictObject({
  schemaVersion: z.literal("blocky.spike-project/v1"),
  projectId: z.string(),
  workspace: jsonValueSchema,
  program: programSchema,
  interactionManifest: interactionManifestSchema,
});

function parseSnapshot(record: ProjectRecord, projectId: string): SpikeProjectSnapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(record.json);
  } catch {
    throw new HostBridgeError("PROJECT_JSON_INVALID", "项目 JSON 无效");
  }

  if (
    !raw ||
    typeof raw !== "object" ||
    (raw as { schemaVersion?: unknown }).schemaVersion !== "blocky.spike-project/v1"
  ) {
    throw new HostBridgeError(
      "PROJECT_SCHEMA_UNSUPPORTED",
      "项目格式版本不受支持",
    );
  }

  const parsed = snapshotSchema.safeParse(raw);
  if (!parsed.success) {
    throw new HostBridgeError("PROJECT_JSON_INVALID", "项目 JSON 无效");
  }
  if (record.projectId !== projectId || parsed.data.projectId !== projectId) {
    throw new HostBridgeError("PROJECT_ID_MISMATCH", "项目标识不匹配");
  }
  if (scanSensitiveValues(parsed.data).length > 0) {
    throw new HostBridgeError(
      "PROJECT_SENSITIVE_VALUE",
      "项目包含不允许保存的敏感值",
    );
  }

  const compiled = compileWorkspace(parsed.data.workspace);
  const interaction = compileInteractionManifest(compiled.program);
  if (
    stableStringify(compiled.program) !== stableStringify(parsed.data.program) ||
    stableStringify(interaction.manifest) !==
      stableStringify(parsed.data.interactionManifest)
  ) {
    throw new HostBridgeError(
      "PROJECT_DERIVED_DATA_MISMATCH",
      "项目派生数据不一致",
    );
  }

  return parsed.data;
}

export class TauriHostBridge implements HostBridge {
  async saveProject(request: SaveProjectRequest): Promise<void> {
    if (scanSensitiveValues(request.project).length > 0) {
      throw new HostBridgeError(
        "PROJECT_SENSITIVE_VALUE",
        "项目包含不允许保存的敏感值",
      );
    }
    const nativeRequest: NativeSaveProjectRequest = {
      projectId: request.project.projectId,
      json: stableStringify(request.project),
    };
    await invoke<ProjectRecord>("save_project", { request: nativeRequest });
  }

  async loadProject(projectId: string): Promise<SpikeProjectSnapshot> {
    const record = await invoke<ProjectRecord>("load_project", { projectId });
    return parseSnapshot(record, projectId);
  }
}
