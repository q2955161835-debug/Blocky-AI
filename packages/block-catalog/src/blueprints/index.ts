import { z } from "zod";
import {
  digest,
  stableId,
  validRef,
  type Project,
  type WorkspaceBlock,
} from "@blocky/language-schema";
import { getBlock, catalogVersion } from "../catalog";
const id = z.string().regex(stableId).max(200);
const coordinate = z.number().finite().min(-100000).max(100000);
const block: z.ZodType<WorkspaceBlock> = z.lazy(() =>
  z
    .object({
      type: z.string().max(200),
      id,
      fields: z.record(z.string(), z.json()).optional(),
      inputs: z
        .record(
          z.string(),
          z
            .object({ block: block.optional(), shadow: block.optional() })
            .strict(),
        )
        .optional(),
      next: z.object({ block }).strict().optional(),
      x: coordinate.optional(),
      y: coordinate.optional(),
      disabled: z.boolean().optional(),
      collapsed: z.boolean().optional(),
    })
    .strict(),
);
export const workspaceBlockShape = block;
const schema = z
  .object({
    schemaVersion: z.literal("blocky.blueprint/v1alpha1"),
    blueprintId: id,
    displayName: z.string().min(1).max(100),
    version: z.literal(1),
    catalogVersion: z.enum([catalogVersion, "0.1.0"]),
    source: z
      .object({ kind: z.literal("personal"), projectId: id, moduleId: id })
      .strict(),
    roots: z.array(block).min(1).max(100),
    resources: z
      .array(
        z
          .object({
            slotId: id,
            kind: z.enum(["model", "knowledge"]),
            defaultResourceId: id,
          })
          .strict(),
      )
      .max(100),
    modules: z
      .array(
        z
          .object({
            slotId: id,
            defaultModuleId: id,
            exportId: id,
            inputSchemaRef: z.string().refine(validRef),
            outputSchemaRef: z.string().refine(validRef),
          })
          .strict(),
      )
      .max(100),
    digest: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export type Blueprint = z.infer<typeof schema>;
export type BlueprintBindings = {
  resources: Record<string, string>;
  modules: Record<string, string>;
};
export function* walkBlocks(
  roots: WorkspaceBlock[],
): Generator<WorkspaceBlock> {
  for (const root of roots) {
    yield root;
    for (const child of Object.values(root.inputs ?? {})) {
      if (child.block) yield* walkBlocks([child.block]);
      if (child.shadow) yield* walkBlocks([child.shadow]);
    }
    if (root.next) yield* walkBlocks([root.next.block]);
  }
}
function guard(input: unknown) {
  let count = 0;
  const visit = (v: unknown, depth: number) => {
    if (++count > 10000 || depth > 60) throw Error("BLK-BLUEPRINT-001");
    if (
      typeof v === "string" &&
      /\bBearer\s+\S+|(?:password|token|api[_-]?key)\s*[=:]\s*\S+/i.test(v)
    )
      throw Error("BLK-BLUEPRINT-001");
    if (v && typeof v === "object") {
      for (const [key, value] of Object.entries(v)) {
        if (
          [
            "apikey",
            "authorization",
            "password",
            "cookie",
            "accesstoken",
            "refreshtoken",
            "clientsecret",
            "privatekey",
            "token",
            "secret",
            "credential",
            "credentials",
            "bearer",
            "sessiontoken",
            "signingkey",
          ].includes(key.toLowerCase().replace(/[_-]/g, ""))
        )
          throw Error("BLK-BLUEPRINT-001");
        visit(value, depth + 1);
      }
    }
  };
  visit(input, 0);
}
function validateRoots(roots: WorkspaceBlock[]) {
  const seen = new Set<string>();
  for (const b of walkBlocks(roots)) {
    const definition = getBlock(b.type);
    if (!definition || seen.has(b.id) || b.type === "core.tool.entry")
      throw Error("BLK-BLUEPRINT-001");
    seen.add(b.id);
    if (
      Object.keys(b.fields ?? {}).some(
        (key) => !definition.fields.includes(key),
      ) ||
      Object.keys(b.inputs ?? {}).some(
        (key) => !definition.inputs.includes(key),
      )
    )
      throw Error("BLK-BLUEPRINT-001");
    for (const field of definition.fields) {
      const value = b.fields?.[field];
      if (value === undefined && definition.optionalFields?.includes(field))
        continue;
      if (definition.jsonFields?.includes(field)) {
        if (value === undefined || JSON.stringify(value).length > 16000)
          throw Error("BLK-BLUEPRINT-001");
        continue;
      }
      if (
        typeof value !== "string" ||
        value.length > 16000 ||
        !value ||
        /\bBearer\s+\S+|(?:password|token|api[_-]?key)\s*[=:]\s*\S+/i.test(
          value,
        )
      )
        throw Error("BLK-BLUEPRINT-001");
    }
  }
}
export async function parseBlueprint(input: unknown): Promise<Blueprint> {
  try {
    guard(input);
    const parsed = schema.parse(input);
    validateRoots(parsed.roots);
    const { digest: expected, ...content } = parsed;
    if ((await digest(content)) !== expected) throw Error("BLK-BLUEPRINT-003");
    const slots = [...parsed.resources, ...parsed.modules].map((s) => s.slotId);
    if (new Set(slots).size !== slots.length) throw Error("BLK-BLUEPRINT-001");
    for (const b of walkBlocks(parsed.roots)) {
      if (
        b.fields?.RESOURCE &&
        !parsed.resources.some(
          (s) =>
            s.slotId === b.fields!.RESOURCE &&
            s.kind ===
              (b.type === "core.model.compose" ? "model" : "knowledge"),
        )
      )
        throw Error("BLK-BLUEPRINT-002");
      if (
        b.type === "core.module.call" &&
        !parsed.modules.some(
          (s) =>
            s.slotId === b.fields?.MODULE &&
            s.exportId === b.fields.EXPORT &&
            s.inputSchemaRef === b.fields.INPUT &&
            s.outputSchemaRef === b.fields.OUTPUT,
        )
      )
        throw Error("BLK-BLUEPRINT-002");
    }
    return parsed;
  } catch (error) {
    if (error instanceof Error && /^BLK-BLUEPRINT-\d{3}$/.test(error.message))
      throw error;
    throw Error("BLK-BLUEPRINT-001");
  }
}
export async function captureBlueprint(
  project: Project,
  moduleId: string,
  selected: string[],
  displayName: string,
  blueprintId = `blueprint-${crypto.randomUUID()}`,
): Promise<Blueprint> {
  const workspace = project.workspaces[moduleId];
  if (
    !workspace ||
    !selected.length ||
    new Set(selected).size !== selected.length
  )
    throw Error("BLK-BLUEPRINT-001");
  const roots = structuredClone(
    workspace.blocks.blocks.filter((b) => selected.includes(b.id)),
  );
  if (roots.length !== selected.length) throw Error("BLK-BLUEPRINT-001");
  guard(roots);
  validateRoots(roots);
  const minX = Math.min(...roots.map((b) => b.x ?? 0)),
    minY = Math.min(...roots.map((b) => b.y ?? 0));
  for (const root of roots) {
    root.x = (root.x ?? 0) - minX;
    root.y = (root.y ?? 0) - minY;
  }
  const resources: Blueprint["resources"] = [],
    modules: Blueprint["modules"] = [];
  for (const b of walkBlocks(roots)) {
    if (b.fields?.RESOURCE) {
      const resourceId = String(b.fields.RESOURCE),
        kind = b.type === "core.model.compose" ? "model" : "knowledge";
      if (
        !project.manifest.resources.some(
          (r) => r.resourceId === resourceId && r.kind === kind,
        )
      )
        throw Error("BLK-BLUEPRINT-002");
      let slot = resources.find(
        (r) => r.defaultResourceId === resourceId && r.kind === kind,
      );
      if (!slot) {
        slot = {
          slotId: `resource-slot-${resources.length + 1}`,
          kind,
          defaultResourceId: resourceId,
        };
        resources.push(slot);
      }
      b.fields.RESOURCE = slot.slotId;
    }
    if (b.type === "core.module.call") {
      const f = b.fields!;
      const target = project.manifest.modules
        .find((m) => m.moduleId === f.MODULE)
        ?.exports.find((e) => e.exportId === f.EXPORT);
      if (
        !target ||
        target.inputSchemaRef !== f.INPUT ||
        target.outputSchemaRef !== f.OUTPUT
      )
        throw Error("BLK-BLUEPRINT-002");
      let slot = modules.find(
        (s) => s.defaultModuleId === f.MODULE && s.exportId === f.EXPORT,
      );
      if (!slot) {
        slot = {
          slotId: `module-slot-${modules.length + 1}`,
          defaultModuleId: String(f.MODULE),
          exportId: String(f.EXPORT),
          inputSchemaRef: String(f.INPUT),
          outputSchemaRef: String(f.OUTPUT),
        };
        modules.push(slot);
      }
      f.MODULE = slot.slotId;
    }
  }
  const content = {
    schemaVersion: "blocky.blueprint/v1alpha1" as const,
    blueprintId,
    displayName,
    version: 1 as const,
    catalogVersion,
    source: {
      kind: "personal" as const,
      projectId: project.manifest.projectId,
      moduleId,
    },
    roots,
    resources,
    modules,
  };
  return parseBlueprint({ ...content, digest: await digest(content) });
}
export function defaultBindings(blueprint: Blueprint): BlueprintBindings {
  return {
    resources: Object.fromEntries(
      blueprint.resources.map((r) => [r.slotId, r.defaultResourceId]),
    ),
    modules: Object.fromEntries(
      blueprint.modules.map((m) => [m.slotId, m.defaultModuleId]),
    ),
  };
}
export async function instantiateBlueprint(
  input: unknown,
  project: Project,
  moduleId: string,
  bindings: BlueprintBindings,
  offset = { x: 80, y: 80 },
  newId = () => `block-${crypto.randomUUID()}`,
): Promise<WorkspaceBlock[]> {
  const blueprint = await parseBlueprint(input);
  if (
    !project.workspaces[moduleId] ||
    !Number.isFinite(offset.x) ||
    !Number.isFinite(offset.y)
  )
    throw Error("BLK-BLUEPRINT-002");
  for (const slot of blueprint.resources)
    if (
      !project.manifest.resources.some(
        (r) =>
          r.resourceId === bindings.resources[slot.slotId] &&
          r.kind === slot.kind,
      )
    )
      throw Error("BLK-BLUEPRINT-002");
  for (const slot of blueprint.modules) {
    const target = project.manifest.modules
      .find((m) => m.moduleId === bindings.modules[slot.slotId])
      ?.exports.find((e) => e.exportId === slot.exportId);
    if (
      !target ||
      target.inputSchemaRef !== slot.inputSchemaRef ||
      target.outputSchemaRef !== slot.outputSchemaRef
    )
      throw Error("BLK-BLUEPRINT-002");
  }
  const used = new Set(
    Object.values(project.workspaces).flatMap((w) =>
      [...walkBlocks(w.blocks.blocks)].map((b) => b.id),
    ),
  );
  const roots = structuredClone(blueprint.roots);
  for (const b of walkBlocks(roots)) {
    const id = newId();
    if (!stableId.test(id) || used.has(id)) throw Error("BLK-BLUEPRINT-004");
    used.add(id);
    b.id = id;
    if (b.fields?.RESOURCE)
      b.fields.RESOURCE = bindings.resources[String(b.fields.RESOURCE)];
    if (b.type === "core.module.call")
      b.fields!.MODULE = bindings.modules[String(b.fields!.MODULE)];
  }
  for (const root of roots) {
    root.x = (root.x ?? 0) + offset.x;
    root.y = (root.y ?? 0) + offset.y;
  }
  return roots;
}
