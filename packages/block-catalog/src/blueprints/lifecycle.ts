import { z } from "zod";
import {
  canonicalJson,
  stableId,
  type Json,
  type Project,
  type WorkspaceBlock,
} from "@blocky/language-schema";
import {
  instantiateBlueprint,
  parseBlueprint,
  walkBlocks,
  workspaceBlockShape,
  validateBlueprintBase,
  type BlueprintBindings,
} from "./index";
const id = z.string().regex(stableId).max(200);
const instanceSchema = z
  .object({
    schemaVersion: z.literal("blocky.blueprint-instance/v1"),
    instanceId: id,
    blueprintId: id,
    version: z.number().int().positive(),
    digest: z.string().regex(/^[a-f0-9]{64}$/),
    sourceRootId: id,
    idMap: z.record(id, id),
    bindings: z
      .object({ resources: z.record(id, id), modules: z.record(id, id) })
      .strict(),
    base: workspaceBlockShape,
  })
  .strict();
export function blueprintInstance(root: WorkspaceBlock) {
  try {
    const extra = root.extraState;
    if (
      !extra ||
      typeof extra !== "object" ||
      Array.isArray(extra) ||
      !extra.blueprintInstance
    )
      return undefined;
    const raw = extra.blueprintInstance;
    let count = 0;
    const visit = (value: unknown, depth: number) => {
      if (++count > 20000 || depth > 80) throw Error();
      if (value && typeof value === "object")
        Object.values(value).forEach((v) => visit(v, depth + 1));
    };
    visit(raw, 0);
    const parsed = instanceSchema.parse(raw);
    validateBlueprintBase([parsed.base]);
    if (
      parsed.base.id !== root.id ||
      parsed.idMap[parsed.sourceRootId] !== root.id ||
      [...walkBlocks([parsed.base])].some((b) => b.extraState !== undefined)
    )
      return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}
const equal = (a: unknown, b: unknown) =>
  a === undefined || b === undefined
    ? a === b
    : canonicalJson(a) === canonicalJson(b);
export type BlueprintConflict = {
  path: string;
  base: Json | null;
  user: Json | null;
  incoming: Json | null;
};
export type BlueprintUpdate = {
  blueprintId: string;
  fromVersion: number;
  toVersion: number;
  mode: "update" | "restore";
  conflicts: BlueprintConflict[];
  changes: { before?: WorkspaceBlock; after?: WorkspaceBlock }[];
};
/** Pure three-way merge. Nothing is applied until the existing patch transaction is accepted. */
export async function previewBlueprintUpdate(
  project: Project,
  moduleId: string,
  rootId: string,
  input: unknown,
  mode: "update" | "restore" = "update",
  resolution?: "keep-user" | "upstream",
): Promise<BlueprintUpdate> {
  const template = await parseBlueprint(input),
    workspace = project.workspaces[moduleId];
  const selected = workspace?.blocks.blocks.find((b) => b.id === rootId),
    instance = selected && blueprintInstance(selected);
  if (
    !workspace ||
    !selected ||
    !instance ||
    instance.blueprintId !== template.blueprintId ||
    (mode === "update" && template.version <= instance.version)
  )
    throw Error("BLK-BLUEPRINT-005");
  const members = workspace.blocks.blocks
    .map((root) => ({ root, state: blueprintInstance(root) }))
    .filter((p) => p.state?.instanceId === instance.instanceId);
  if (
    members.some(
      (m) =>
        m.state!.blueprintId !== instance.blueprintId ||
        m.state!.digest !== instance.digest,
    )
  )
    throw Error("BLK-BLUEPRINT-005");
  const sourceRoots = new Set(members.map((m) => m.state!.sourceRootId));
  if (sourceRoots.size !== members.length) throw Error("BLK-BLUEPRINT-005");
  const mapping = Object.assign(
    {},
    ...members.map((m) => m.state!.idMap),
  ) as Record<string, string>;
  const bindings: BlueprintBindings = instance.bindings;
  const cleanProject = structuredClone(project);
  cleanProject.workspaces[moduleId].blocks.blocks =
    workspace.blocks.blocks.filter(
      (b) => !members.some((m) => m.root.id === b.id),
    );
  const incoming = await instantiateBlueprint(
    template,
    cleanProject,
    moduleId,
    bindings,
    { x: 0, y: 0 },
    (sourceId) => mapping[sourceId] ?? `block-${crypto.randomUUID()}`,
  );
  const conflicts: BlueprintConflict[] = [],
    changes: BlueprintUpdate["changes"] = [];
  const merge = (
    base: unknown,
    user: unknown,
    next: unknown,
    path: string,
  ): any => {
    if (equal(user, base)) return structuredClone(next);
    if (equal(next, base) || equal(user, next)) return structuredClone(user);
    const objects = [base, user, next].every(
      (v) => v && typeof v === "object" && !Array.isArray(v),
    );
    if (objects) {
      const b = base as Record<string, unknown>,
        u = user as Record<string, unknown>,
        n = next as Record<string, unknown>;
      return Object.fromEntries(
        [...new Set([...Object.keys(b), ...Object.keys(u), ...Object.keys(n)])]
          .map((key) => [key, merge(b[key], u[key], n[key], `${path}/${key}`)])
          .filter(([, value]) => value !== undefined),
      );
    }
    conflicts.push({
      path,
      base: (base ?? null) as Json,
      user: (user ?? null) as Json,
      incoming: (next ?? null) as Json,
    });
    return structuredClone(resolution === "upstream" ? next : user);
  };
  for (let i = 0; i < incoming.length; i++) {
    const fresh = incoming[i],
      newState = blueprintInstance(fresh)!;
    const previous = members.find(
      (m) => m.state!.sourceRootId === template.roots[i].id,
    );
    if (!previous) {
      fresh.x = (selected.x ?? 0) + (fresh.x ?? 0);
      fresh.y = (selected.y ?? 0) + (fresh.y ?? 0);
      newState.base.x = fresh.x;
      newState.base.y = fresh.y;
      newState.instanceId = instance.instanceId;
      fresh.extraState = { blueprintInstance: newState } as unknown as Json;
      changes.push({ after: fresh });
      continue;
    }
    fresh.x = previous.state!.base.x;
    fresh.y = previous.state!.base.y;
    newState.base.x = fresh.x;
    newState.base.y = fresh.y;
    newState.instanceId = instance.instanceId;
    const user = structuredClone(previous.root);
    delete user.extraState;
    const next = structuredClone(fresh);
    delete next.extraState;
    const after: WorkspaceBlock =
      mode === "restore"
        ? next
        : merge(previous.state!.base, user, next, previous.root.id);
    if (mode === "restore") {
      const current = new Map([...walkBlocks([user])].map((b) => [b.id, b]));
      for (const block of walkBlocks([after])) {
        const old = current.get(block.id);
        if (!old || old.type !== block.type) continue;
        for (const field of [
          "RESOURCE",
          ...(block.type === "core.module.call"
            ? ["MODULE", "EXPORT", "INPUT", "OUTPUT"]
            : []),
        ]) {
          if (old.fields?.[field] !== undefined)
            block.fields![field] = old.fields[field];
        }
      }
    }
    // Restore content but preserve the user's canvas placement and collapsed view.
    after.x = previous.root.x;
    after.y = previous.root.y;
    if (previous.root.collapsed !== undefined)
      after.collapsed = previous.root.collapsed;
    after.extraState = { blueprintInstance: newState } as unknown as Json;
    changes.push({ before: previous.root, after });
  }
  for (const previous of members.filter(
    (m) => !template.roots.some((r) => r.id === m.state!.sourceRootId),
  )) {
    const user = structuredClone(previous.root);
    delete user.extraState;
    const after =
      mode === "restore"
        ? undefined
        : merge(previous.state!.base, user, undefined, previous.root.id);
    changes.push({ before: previous.root, ...(after ? { after } : {}) });
  }
  return {
    blueprintId: template.blueprintId,
    fromVersion: instance.version,
    toVersion: template.version,
    mode,
    conflicts,
    changes,
  };
}
