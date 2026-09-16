import { z } from "zod";
import {
  canonicalJson,
  digest,
  stableId,
  validRef,
  type Project,
} from "@blocky/language-schema";
const id = z.string().regex(stableId);
const ref = z.string().refine(validRef, "BLK-REF-001");
const kinds = [
  "model",
  "knowledge",
  "memory",
  "tool",
  "skill",
  "mcp",
  "guardrail",
  "data",
  "task",
] as const;
const moduleExport = z
  .object({
    exportId: id,
    displayName: z.string(),
    kind: z.enum(["agent", "tool", "event", "function", "interaction", "data"]),
    inputSchemaRef: ref.optional(),
    outputSchemaRef: ref.optional(),
  })
  .passthrough();
export const manifestSchema = z
  .object({
    schemaVersion: z.literal("blocky.project/v1alpha1"),
    projectId: id,
    displayName: z.string().min(1),
    modules: z
      .array(
        z
          .object({
            moduleId: id,
            displayName: z.string(),
            purpose: z.enum([
              "agent",
              "automation",
              "service",
              "rule",
              "state-machine",
              "behavior-tree",
              "event-flow",
              "data",
              "general",
            ]),
            workspaceRef: ref,
            exports: z.array(moduleExport),
          })
          .passthrough(),
      )
      .min(1),
    resources: z.array(
      z
        .object({
          resourceId: id,
          kind: z.enum(kinds),
          scope: z.enum(["project", "user"]),
          definitionRef: z.string(),
          secretRefs: z.array(id),
        })
        .passthrough()
        .superRefine((r, c) => {
          if (
            !(r.scope === "project"
              ? validRef(r.definitionRef)
              : stableId.test(r.definitionRef))
          )
            c.addIssue({ code: "custom", message: "BLK-REF-001" });
        }),
    ),
    appSurfaces: z.array(
      z.object({ surfaceId: id, manifestRef: ref }).passthrough(),
    ),
    format: z
      .object({ createdWith: z.string(), minimumReaderVersion: z.string() })
      .passthrough(),
  })
  .passthrough();
const resourceSchema = z
  .object({
    schemaVersion: z.literal("blocky.resource/v1alpha1"),
    resourceId: id,
    kind: z.enum(kinds),
    scope: z.enum(["project", "user"]),
    displayName: z.string(),
    definition: z.record(z.string(), z.json()),
    capabilityRequirements: z.array(z.string()),
    secretBindings: z.array(z.object({ fieldId: id, secretRef: id })),
  })
  .passthrough();
const blockSchema: z.ZodType = z.lazy(() =>
  z
    .object({
      type: z.string(),
      id,
      fields: z.record(z.string(), z.json()).optional(),
      inputs: z
        .record(
          z.string(),
          z
            .object({
              block: blockSchema.optional(),
              shadow: blockSchema.optional(),
            })
            .strict(),
        )
        .optional(),
      next: z.object({ block: blockSchema }).optional(),
      x: z.number().finite().optional(),
      y: z.number().finite().optional(),
      disabled: z.boolean().optional(),
      extraState: z.json().optional(),
    })
    .passthrough(),
);
const projectSchema = z
  .object({
    manifest: manifestSchema,
    workspaces: z.record(
      id,
      z
        .object({
          blocks: z
            .object({
              languageVersion: z.literal(0),
              blocks: z.array(blockSchema),
            })
            .passthrough(),
        })
        .passthrough(),
    ),
    resources: z.record(id, resourceSchema),
    schemas: z.record(ref, z.json()),
    surfaces: z.record(ref, z.json()),
  })
  .strict();
function unique(values: string[]): void {
  if (new Set(values).size !== values.length)
    throw Error("BLK-TYPE-002: 重复标识");
}
export function parseProject(input: unknown): Project {
  canonicalJson(input);
  // Bound untrusted input before recursive schema parsing.
  let count = 0;
  const walk = (v: unknown, depth: number) => {
    if (++count > 50000 || depth > 120)
      throw Error("BLK-TYPE-003: 项目超出预算");
    if (v && typeof v === "object")
      Object.values(v).forEach((x) => walk(x, depth + 1));
  };
  walk(input, 0);
  const p = projectSchema.parse(input) as Project;
  unique(p.manifest.modules.map((m) => m.moduleId));
  unique(p.manifest.modules.map((m) => m.workspaceRef));
  unique(p.manifest.resources.map((r) => r.resourceId));
  unique(p.manifest.appSurfaces.map((s) => s.surfaceId));
  for (const m of p.manifest.modules) {
    unique(m.exports.map((e) => e.exportId));
    if (!p.workspaces[m.moduleId]) throw Error("BLK-REF-001: 缺失 Workspace");
    for (const e of m.exports)
      for (const r of [e.inputSchemaRef, e.outputSchemaRef])
        if (r && !Object.hasOwn(p.schemas, r))
          throw Error("BLK-REF-001: 缺失 Schema");
  }
  if (
    Object.keys(p.workspaces).some(
      (k) => !p.manifest.modules.some((m) => m.moduleId === k),
    )
  )
    throw Error("BLK-REF-001: 未声明 Workspace");
  for (const r of p.manifest.resources)
    if (r.scope === "project") {
      const d = p.resources[r.resourceId];
      if (!d || d.kind !== r.kind || d.scope !== r.scope)
        throw Error("BLK-RESOURCE-001: 无效资源引用");
    }
  for (const s of p.manifest.appSurfaces)
    if (!Object.hasOwn(p.surfaces, s.manifestRef))
      throw Error("BLK-SURFACE-002: 缺失页面");
  return p;
}
export { ProjectController } from "./controller";
export { configureBlock, findBlock } from "./configure";
export {
  restoreSession,
  serializeSession,
  type Session,
  type CanvasViewport,
} from "./session";
export const projectDigest = (project: Project) =>
  digest(parseProject(project));
export function createSession(project: Project) {
  return {
    schemaVersion: "blocky.workspace-session/v1alpha1" as const,
    projectId: project.manifest.projectId,
    openTabs: project.manifest.modules.map((m, i) => ({
      tabId: `tab-${m.moduleId}`,
      kind: "canvas" as const,
      targetId: m.moduleId,
      order: i,
    })),
    activeTabId: `tab-${project.manifest.modules[0].moduleId}`,
    bottomPanel: {
      visible: true,
      activeView: "problems" as const,
      heightPx: 210,
      maximized: false,
      filters: {},
    },
    canvasViews: [],
    browserViews: [],
    terminalLayout: { direction: "single", sessionIds: [] },
  };
}
