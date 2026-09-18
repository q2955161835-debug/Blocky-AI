import {
  type Project,
  type Resource,
  type WorkspaceBlock,
  type Json,
  digest,
} from "@blocky/language-schema";
import { projectDigest } from "@blocky/project-model";
import { makePatch } from "@blocky/builder-protocol";
import { analyzeFile } from "./analyze";
import { inspectLicense } from "./license";
import { type ConversionReport, ConversionScanner } from "./scan";
/** Re-read source and lower again: a cached/report-supplied program never authorizes a patch. */
export async function realConversionCandidate(
  project: Project,
  moduleId: string,
  report: ConversionReport,
  selection: { file: string; symbol: string; lineStart: number },
  scanner: ConversionScanner,
  signal = new AbortController().signal,
  userRegistry?: Map<string, Resource>,
) {
  signal.throwIfAborted();
  report = await scanner.analyze(report.artifact, signal);
  if (
    !project.workspaces[moduleId] ||
    report.licenseStatus === "unverified" ||
    !report.licenses.length
  )
    throw Error("BLK-CONVERT-003");
  const licenses: ReturnType<typeof inspectLicense>[] = [];
  for (const claimed of report.licenses) {
    const current = inspectLicense(
      await scanner.source(report.artifact, claimed.file, signal),
    );
    if (
      current.sha256 !== claimed.sha256 ||
      current.detected !== claimed.detected
    )
      throw Error("BLK-CONVERT-CORRUPT");
    licenses.push(current);
  }
  if (
    !licenses.some((l) => l.detected !== "unverified") ||
    licenses.some((l) => l.detected === "unverified" && !/notice/i.test(l.file))
  )
    throw Error("BLK-CONVERT-003");
  const sourceFile = await scanner.source(
    report.artifact,
    selection.file,
    signal,
  );
  const spdx = [
    ...sourceFile.content.matchAll(/SPDX-License-Identifier:\s*([^\r\n*]+)/g),
  ].map((m) => m[1].trim());
  if (spdx.some((id) => !licenses.some((l) => l.detected === id)))
    throw Error("BLK-CONVERT-003");
  const analyzed = analyzeFile(sourceFile.path, sourceFile.content);
  const symbol = analyzed.symbols.find(
    (s) => s.name === selection.symbol && s.lineStart === selection.lineStart,
  );
  if (
    !symbol?.program ||
    !["custom-block", "blueprint"].includes(symbol.decision)
  )
    throw Error("BLK-CONVERT-004");
  const source = {
    repository: report.artifact.repository,
    commit: report.artifact.commit,
    version: report.artifact.commit.slice(0, 12),
    snapshotId: report.artifact.snapshotId,
    license: [
      ...new Set(
        licenses
          .filter((l) => l.detected !== "unverified")
          .map((l) => l.detected),
      ),
    ].join(" + "),
  };
  const provenance = {
    ...source,
    file: sourceFile.path,
    sha256: sourceFile.sha256,
    symbol: symbol.name,
    lineStart: symbol.lineStart,
    lineEnd: symbol.lineEnd,
  };
  const block = (
    type: string,
    fields: Record<string, Json> = {},
    inputs?: WorkspaceBlock["inputs"],
  ): WorkspaceBlock => ({
    type,
    id: `block-${crypto.randomUUID()}`,
    ...(Object.keys(fields).length ? { fields } : {}),
    ...(inputs ? { inputs } : {}),
  });
  let calculation: WorkspaceBlock | undefined;
  const stages =
    symbol.decision === "blueprint" && symbol.stages
      ? symbol.stages
      : [{ name: symbol.name, program: symbol.program }];
  for (const stage of stages)
    calculation = block(
      "core.data.transform",
      {
        NAME: stage.name,
        PROGRAM: stage.program as unknown as Json,
        SOURCE: provenance,
      },
      calculation ? { ARGUMENTS: { block: calculation } } : undefined,
    );
  const root = block(
    "core.agent.define",
    { NAME: symbol.name },
    {
      MEMBERS: {
        block: block(
          "core.interaction.chat_entry",
          { NAME: symbol.name },
          {
            CAPABILITIES: { block: block("core.interaction.accept_text") },
            HANDLER: {
              block: block(
                "core.message.reply",
                {},
                {
                  MESSAGE: {
                    block: block(
                      "core.message.create",
                      {},
                      { CONTENT: { block: calculation! } },
                    ),
                  },
                },
              ),
            },
          },
        ),
      },
    },
  );
  root.x = 420;
  root.y = 100;
  const patch = await makePatch(
    project,
    [{ op: "block.add", moduleId, blockId: root.id, payload: root }],
    userRegistry,
  );
  signal.throwIfAborted();
  return {
    schemaVersion: "blocky.conversion/v1" as const,
    candidateId: `candidate-${crypto.randomUUID()}`,
    artifactType: symbol.decision as "custom-block" | "blueprint",
    displayName: symbol.name,
    rationale: symbol.rationale,
    source,
    sourceArtifact: report.artifact,
    evidence: [
      {
        file: sourceFile.path,
        sha256: sourceFile.sha256,
        lineStart: symbol.lineStart,
        lineEnd: symbol.lineEnd,
        excerpt: sourceFile.content
          .split(/\r?\n/)
          .slice(symbol.lineStart - 1, symbol.lineEnd)
          .join("\n")
          .slice(0, 8000),
        mapsTo: "core.data.transform",
      },
    ],
    retained: [
      ...report.compatibilityReport.retained,
      "输入为 JSON 对象；单参数也接受数字。全部参数和运算结果须为绝对值 ≤ 1e9 的有限数，除零与无效输入停止运行。",
    ],
    dependencies: {
      installed: false,
      runtime: "Blocky 有界数值解释器",
      upstreamRequired: false,
    },
    interface: {
      parameters: symbol.program.parameters,
      output: "number",
      permissions: [],
      errors: ["BLK-EXPR-001", "BLK-EXPR-002"],
    },
    buildSpec: {
      schemaVersion: "blocky.build/v1alpha1",
      requestId: `request-${crypto.randomUUID()}`,
      projectId: project.manifest.projectId,
      baseDigest: await projectDigest(project),
      intent: `转换 ${symbol.name}`,
      targetModuleIds: [moduleId],
      requiredResources: [],
      requestedCapabilities: patch.permissionDelta,
      acceptanceCriteria: [
        "源码定位与许可证可读回",
        "有界数值输入结果等价",
        "拒绝不修改项目",
        "接受后可整体撤销",
      ],
      sourceDigest: await digest(provenance),
    },
    patch,
  };
}
