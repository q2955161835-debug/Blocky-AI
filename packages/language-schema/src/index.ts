export type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | { [key: string]: Json };
export type SourceRef = {
  projectId: string;
  moduleId?: string;
  blockId?: string;
  fileRef?: string;
};
export type Diagnostic = {
  schemaVersion: "blocky.diagnostic/v1alpha1";
  diagnosticId: string;
  code: string;
  severity: "info" | "warning" | "error";
  message: string;
  source?: SourceRef;
  related: SourceRef[];
};
export const stableId = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
export function validRef(value: string): boolean {
  return (
    value.length > 0 &&
    !/[:\\\u0000-\u001f]/u.test(value) &&
    value
      .split("/")
      .every(
        (part) =>
          part !== "" && part !== "." && part !== ".." && !/[. ]$/.test(part),
      )
  );
}
export function canonicalJson(value: unknown): string {
  const seen = new Set<object>();
  const visit = (v: unknown): string => {
    if (v === null || typeof v === "string" || typeof v === "boolean")
      return JSON.stringify(v);
    if (typeof v === "number" && Number.isFinite(v)) return JSON.stringify(v);
    if (typeof v !== "object" || v === null || seen.has(v))
      throw new Error("BLK-TYPE-001: 非 JSON 数据");
    seen.add(v);
    let text: string;
    if (Array.isArray(v)) text = "[" + v.map(visit).join(",") + "]";
    else {
      if (
        Object.getPrototypeOf(v) !== Object.prototype &&
        Object.getPrototypeOf(v) !== null
      )
        throw new Error("BLK-TYPE-001: 非 JSON 对象");
      text =
        "{" +
        Object.keys(v)
          .sort((a, b) => {
            const aa = Array.from(a, (c) => c.codePointAt(0)!);
            const bb = Array.from(b, (c) => c.codePointAt(0)!);
            for (let i = 0; i < Math.min(aa.length, bb.length); i++)
              if (aa[i] !== bb[i]) return aa[i] - bb[i];
            return aa.length - bb.length;
          })
          .map(
            (k) =>
              JSON.stringify(k) +
              ":" +
              visit((v as Record<string, unknown>)[k]),
          )
          .join(",") +
        "}";
    }
    seen.delete(v);
    return text;
  };
  return visit(value);
}
export async function digest(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
export function diagnostic(
  code: string,
  message: string,
  source?: SourceRef,
  related: SourceRef[] = [],
): Diagnostic {
  return {
    schemaVersion: "blocky.diagnostic/v1alpha1",
    diagnosticId: `${code.toLowerCase()}.${source?.moduleId ?? "project"}.${source?.blockId ?? "root"}`,
    code,
    severity: "error",
    message,
    ...(source ? { source } : {}),
    related,
  };
}
export type ModuleExport = {
  exportId: string;
  displayName: string;
  kind: "agent" | "tool" | "event" | "function" | "interaction" | "data";
  inputSchemaRef?: string;
  outputSchemaRef?: string;
};
export type ModuleDescriptor = {
  moduleId: string;
  displayName: string;
  purpose: string;
  workspaceRef: string;
  exports: ModuleExport[];
};
export type ResourceReference = {
  resourceId: string;
  kind: string;
  scope: "project" | "user";
  definitionRef: string;
  secretRefs: string[];
};
export type Manifest = {
  schemaVersion: "blocky.project/v1";
  projectId: string;
  displayName: string;
  modules: ModuleDescriptor[];
  resources: ResourceReference[];
  appSurfaces: { surfaceId: string; manifestRef: string }[];
  format: { createdWith: string; minimumReaderVersion: string };
  settingsRef?: "settings.json";
};
export type WorkspaceBlock = {
  type: string;
  id: string;
  fields?: Record<string, Json>;
  inputs?: Record<string, { block?: WorkspaceBlock; shadow?: WorkspaceBlock }>;
  next?: { block: WorkspaceBlock };
  x?: number;
  y?: number;
  disabled?: boolean;
  collapsed?: boolean;
  extraState?: Json;
};
export type Workspace = {
  blocks: { languageVersion: number; blocks: WorkspaceBlock[] };
};
export type Resource = {
  schemaVersion: "blocky.resource/v1alpha1";
  resourceId: string;
  kind: string;
  scope: "project" | "user";
  displayName: string;
  definition: Record<string, Json>;
  capabilityRequirements: string[];
  secretBindings: { fieldId: string; secretRef: string }[];
};
export type Project = {
  manifest: Manifest;
  workspaces: Record<string, Workspace>;
  resources: Record<string, Resource>;
  schemas: Record<string, Json>;
  surfaces: Record<string, Json>;
  settings?: {
    schemaVersion: "blocky.settings/v1";
    scope: "project";
    values: Record<string, Json>;
  };
};
export type IrNode = {
  nodeId: string;
  blockType: string;
  fields: Record<string, Json>;
  inputs: Record<string, IrNode | IrNode[] | null>;
  next?: IrNode;
};
export type ModuleIR = {
  schemaVersion: "blocky.module-ir/v1";
  projectId: string;
  moduleId: string;
  roots: IrNode[];
  exports: ModuleExport[];
  sourceMap: Record<string, SourceRef>;
};
export type ProjectLink = {
  linkId: string;
  source: SourceRef & { portId: string };
  target: { moduleId: string; exportId: string };
  mode: "sync" | "async" | "stream" | "event";
  timeoutMs?: number;
  eventPolicy?: { maxInFlight: number; cancellation: "propagate" | "isolate" };
};
export type ProjectIR = {
  schemaVersion: "blocky.project-ir/v1";
  projectId: string;
  modules: { moduleId: string; digest: string }[];
  links: ProjectLink[];
};
export type InteractionManifest = {
  schemaVersion: "blocky.interaction/v1alpha1";
  projectId: string;
  entries: {
    interactionId: string;
    moduleId: string;
    ownerAgentId: string;
    displayName: string;
    acceptedParts: ("text" | "image" | "audio" | "file")[];
    exposedSkills: string[];
    exposedActions: string[];
    executionRequirements: string[];
  }[];
};
/** UI/session identity only; wire protocols retain both stable IDs. */
export function interactionKey(entry: {
  moduleId: string;
  interactionId: string;
}) {
  return JSON.stringify([entry.moduleId, entry.interactionId]);
}
export type ToolContract = {
  schemaVersion: "blocky.tool/v1alpha1";
  toolId: string;
  moduleId: string;
  displayName: string;
  description: string;
  inputSchemaRef: string;
  outputSchemaRef: string;
  permissions: string[];
  approval: "never" | "on-risk" | "always";
  implementationRef: string;
};
