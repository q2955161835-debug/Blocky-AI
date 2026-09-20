import { z } from "zod";
import type { Project, Resource } from "@blocky/language-schema";
import {
  builderWorkIds,
  parseBuilderRequest,
  createBuilderSession,
} from "@blocky/builder-protocol";
import { ConversionScanner } from "./scan";
import { artifactSchema } from "./snapshot";
import { realConversionCandidate } from "./candidate";
const sourceInput = z
  .object({
    schemaVersion: z.literal("blocky.work-input/v1"),
    moduleId: z.string(),
    artifact: artifactSchema,
    selection: z
      .object({
        file: z.string(),
        symbol: z.string(),
        lineStart: z.number().int().positive(),
      })
      .strict()
      .optional(),
  })
  .strict();
/** Official work identifiers are domain routes, not installed/published Skills. */
export async function runBuilderWork(
  project: Project,
  workId: string,
  input: unknown,
  ports: {
    signal: AbortSignal;
    registry?: Map<string, Resource>;
    scanner?: ConversionScanner;
    build?: (
      request: ReturnType<typeof parseBuilderRequest>,
    ) => Promise<unknown>;
  },
) {
  ports.signal.throwIfAborted();
  if (!(builderWorkIds as readonly string[]).includes(workId))
    throw Error("BLK-WORK-001");
  if (workId === "build-blocky-agents") {
    const request = parseBuilderRequest(input);
    if (!ports.build) throw Error("BLK-WORK-002");
    return ports.build(request);
  }
  if (workId === "create-blocky-blocks") {
    const parsed = z
      .object({
        schemaVersion: z.literal("blocky.work-input/v1"),
        request: z.unknown(),
        operations: z.array(z.unknown()).min(1).max(100),
      })
      .strict()
      .safeParse(input);
    if (!parsed.success) throw Error("BLK-WORK-001");
    const request = parseBuilderRequest(parsed.data.request);
    if (request.intent !== "build" || request.createSurface)
      throw Error("BLK-WORK-001");
    const session = await createBuilderSession(project, request, ports);
    session.draft({
      plan: ["校验声明的自定义积木候选"],
      acceptanceCriteria: ["目标模块编译通过", "仅在接受后应用"],
    });
    await session.patch({ operations: parsed.data.operations });
    await session.verify();
    return session.result();
  }
  const parsed = sourceInput.safeParse(input);
  if (!parsed.success) throw Error("BLK-WORK-001");
  if (!ports.scanner) throw Error("BLK-WORK-002");
  if (!project.workspaces[parsed.data.moduleId]) throw Error("BLK-BUILDER-002");
  const report = await ports.scanner.analyze(
    parsed.data.artifact,
    ports.signal,
  );
  if (workId === "convert-github-project-to-blocky") {
    if (!parsed.data.selection) throw Error("BLK-WORK-001");
    return realConversionCandidate(
      project,
      parsed.data.moduleId,
      report,
      parsed.data.selection,
      ports.scanner,
      ports.signal,
      ports.registry,
    );
  }
  // Reverse inspection keeps source identities and explicit unmapped parts. It never invents framework parity.
  const retained = report.files.flatMap((f) =>
    f.symbols
      .filter((s) => !s.program)
      .map((s) => ({
        file: f.path,
        symbol: s.name,
        lineStart: s.lineStart,
        decision: s.decision,
      })),
  );
  const convertible = report.files.flatMap((f) =>
    f.symbols
      .filter((s) => !!s.program)
      .map((s) => ({
        file: f.path,
        symbol: s.name,
        lineStart: s.lineStart,
        decision: s.decision,
      })),
  );
  const candidate = parsed.data.selection
    ? await realConversionCandidate(
        project,
        parsed.data.moduleId,
        report,
        parsed.data.selection,
        ports.scanner,
        ports.signal,
        ports.registry,
      )
    : undefined;
  return {
    schemaVersion: "blocky.reverse-report/v1",
    source: report.artifact,
    completeCompatibility: false,
    retained,
    convertible,
    ...(candidate ? { candidate } : {}),
    applied: false,
  };
}
