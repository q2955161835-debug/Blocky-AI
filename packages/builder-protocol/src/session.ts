import { z } from "zod";
import {
  canonicalJson,
  type Project,
  type Resource,
} from "@blocky/language-schema";
import { walkBlocks } from "@blocky/block-catalog";
import { compileProject } from "@blocky/compiler";
import { inspectBuilder } from "./inspect";
import {
  builderInputBudget,
  draftInputSchema,
  parseBuilderRequest,
  type BuildSpec,
} from "./request";
import { makePatch, previewPatch } from "./preview";
import { parsePatch } from "./validate";

export type BuilderResult = {
  requestId: string;
  projectId: string;
  baseDigest: string;
  spec: BuildSpec;
  explanation?: string;
  patch?: ReturnType<typeof parsePatch>;
  verification?: { passed: boolean; diagnosticCount: number };
};

/** An isolated proposal workspace. This object has no write, shell or network port. */
export async function createBuilderSession(
  inputProject: Project,
  input: unknown,
  options: { registry?: Map<string, Resource>; signal?: AbortSignal } = {},
) {
  const request = parseBuilderRequest(input),
    project = structuredClone(inputProject);
  const registry = options.registry
    ? structuredClone(options.registry)
    : undefined;
  const inspected = await inspectBuilder(project, request, registry);
  let cancelled = false,
    calls = 0,
    pending = false;
  let spec: BuildSpec | undefined,
    review: Awaited<ReturnType<typeof previewPatch>> | undefined;
  let verification: BuilderResult["verification"];
  const guard = () => {
    if (cancelled || options.signal?.aborted)
      throw Error("BLK-BUILDER-CANCELLED");
    if (++calls > 64) throw Error("BLK-BUILDER-BUDGET");
  };
  const read = () => {
    guard();
    return structuredClone(inspected);
  };
  const draft = (value: unknown): BuildSpec => {
    guard();
    if (pending) throw Error("BLK-BUILDER-004");
    let parsed: z.infer<typeof draftInputSchema>;
    try {
      builderInputBudget(value);
      parsed = draftInputSchema.parse(value);
    } catch {
      throw Error("BLK-BUILDER-001");
    }
    if (request.intent === "explain" && !parsed.explanation?.trim())
      throw Error("BLK-BUILDER-001");
    spec = {
      ...parsed,
      schemaVersion: "blocky.build/v1",
      requestId: request.requestId,
      projectId: request.projectId,
      baseDigest: inspected.baseDigest,
      intent: request.intent,
      targetModuleIds: [request.moduleId],
      selectedBlockIds: [...request.selection],
      createSurface: request.createSurface,
    };
    review = undefined;
    verification = undefined;
    return structuredClone(spec);
  };
  const patch = async (value: unknown) => {
    guard();
    if (request.intent === "explain") throw Error("BLK-BUILDER-003");
    if (!spec || pending) throw Error("BLK-BUILDER-004");
    builderInputBudget(value);
    const envelope = z
      .object({ operations: z.array(z.unknown()).min(1).max(100) })
      .strict()
      .safeParse(value);
    if (!envelope.success) throw Error("BLK-BUILDER-001");
    // Parse using the same semantic operation schema as desktop, CLI and Host.
    const parsed = parsePatch({
      schemaVersion: "blocky.patch/v1alpha1",
      patchId: `patch-${crypto.randomUUID()}`,
      projectId: request.projectId,
      baseDigest: inspected.baseDigest,
      catalogVersion: inspected.catalogVersion,
      operations: envelope.data.operations,
      permissionDelta: [],
      diagnostics: [],
    });
    const repairScope = new Set(
      request.selection.length
        ? request.selection
        : inspected.diagnostics.flatMap((d) =>
            d.source?.blockId ? [d.source.blockId] : [],
          ),
    );
    for (const op of parsed.operations) {
      if (op.op === "app-surface.add") {
        if (
          !request.createSurface ||
          request.intent !== "build" ||
          op.manifest.associatedModuleIds.some((id) => id !== request.moduleId)
        )
          throw Error("BLK-BUILDER-003");
      } else {
        if (op.moduleId !== request.moduleId) throw Error("BLK-BUILDER-003");
        if (request.intent === "repair") {
          if (op.op !== "block.update" || !repairScope.has(op.blockId))
            throw Error("BLK-BUILDER-003");
        }
        if (op.op === "block.add") {
          const oldIds = new Set(
            [
              ...walkBlocks(project.workspaces[request.moduleId].blocks.blocks),
            ].map((b) => b.id),
          );
          if ([...walkBlocks([op.payload])].some((b) => oldIds.has(b.id)))
            throw Error("BLK-BUILDER-003");
        }
      }
    }
    pending = true;
    try {
      const candidate = await makePatch(project, parsed.operations, registry);
      const nextReview = await previewPatch(project, candidate, registry);
      guard();
      if (canonicalJson(project) === canonicalJson(nextReview.next))
        throw Error("BLK-BUILDER-005");
      review = nextReview;
      verification = undefined;
      return structuredClone(review);
    } finally {
      pending = false;
    }
  };
  const verify = async () => {
    guard();
    if (!spec || pending || (request.intent !== "explain" && !review))
      throw Error("BLK-BUILDER-004");
    const compiled = await compileProject(review?.next ?? project, registry);
    guard();
    verification = {
      passed: !compiled.diagnostics.some((d) => d.severity === "error"),
      diagnosticCount: compiled.diagnostics.length,
    };
    return structuredClone(verification);
  };
  const result = (): BuilderResult => {
    guard();
    if (
      !spec ||
      pending ||
      (request.intent !== "explain" && (!review || !verification?.passed))
    )
      throw Error("BLK-BUILDER-004");
    return structuredClone({
      requestId: request.requestId,
      projectId: request.projectId,
      baseDigest: inspected.baseDigest,
      spec,
      explanation: spec.explanation,
      ...(review ? { patch: review.patch } : {}),
      ...(verification ? { verification } : {}),
    });
  };
  return {
    inspect: read,
    draft,
    patch,
    verify,
    result,
    cancel() {
      cancelled = true;
      review = undefined;
      verification = undefined;
    },
    async call(name: string, value: unknown) {
      switch (name) {
        case "inspect":
          if (canonicalJson(value) !== "{}") throw Error("BLK-BUILDER-001");
          return read();
        case "draft":
          return draft(value);
        case "patch":
          return patch(value);
        case "verify":
          if (canonicalJson(value) !== "{}") throw Error("BLK-BUILDER-001");
          return verify();
        default:
          throw Error("BLK-BUILDER-003");
      }
    },
  };
}
export type BuilderSession = Awaited<ReturnType<typeof createBuilderSession>>;
