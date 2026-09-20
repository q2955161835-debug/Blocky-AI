import fixture from "../fixtures/haystack-bm25.json";
export { runBuilderWork } from "./builder-work";
export {
  analyzeFile,
  type FileAnalysis,
  type SymbolAnalysis,
  type ConversionDecision,
} from "./analyze";
export {
  ConversionScanner,
  type ConversionReport,
  type ConversionCall,
} from "./scan";
export { realConversionCandidate } from "./candidate";
export { artifactSchema, type SourceArtifact } from "./snapshot";
import { z } from "zod";
import { validRef, type Project, type Resource } from "@blocky/language-schema";
import { projectDigest } from "@blocky/project-model";
import { makePatch } from "@blocky/builder-protocol";
export const lockedSnapshot = fixture;
const schema = z
  .object({
    schemaVersion: z.literal("blocky.source-snapshot/v1alpha1"),
    snapshotId: z.literal("haystack-bm25"),
    repository: z.literal("https://github.com/deepset-ai/haystack"),
    commit: z.literal("d72ed6cb37abebaefda8da39e3e7a5d8fffb2065"),
    version: z.literal("v2.9.0"),
    license: z.literal("Apache-2.0"),
    dependencyManifest: z.literal("pyproject.toml"),
    files: z
      .array(
        z
          .object({
            path: z.string().refine(validRef),
            content: z.string().max(40000),
            sha256: z.string().regex(/^[a-f0-9]{64}$/),
          })
          .strict(),
      )
      .length(3),
  })
  .strict();
const trustedHashes = Object.freeze(
  Object.fromEntries(fixture.files.map((f) => [f.path, f.sha256])),
);
export async function validateSnapshot(input: unknown) {
  try {
    const snapshot = schema.parse(input);
    if (
      new Set(snapshot.files.map((f) => f.path)).size !== snapshot.files.length
    )
      throw Error();
    for (const file of snapshot.files) {
      const hash = [
        ...new Uint8Array(
          await crypto.subtle.digest(
            "SHA-256",
            new TextEncoder().encode(file.content),
          ),
        ),
      ]
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      if (file.sha256 !== trustedHashes[file.path] || hash !== file.sha256)
        throw Error();
    }
    return snapshot;
  } catch {
    throw Error("BLK-CONVERT-001");
  }
}
export async function conversionCandidate(
  project: Project,
  moduleId: string,
  resourceId: string,
  signal = new AbortController().signal,
  userRegistry?: Map<string, Resource>,
) {
  signal.throwIfAborted();
  const snapshot = await validateSnapshot(fixture);
  signal.throwIfAborted();
  if (
    !project.workspaces[moduleId] ||
    !project.manifest.resources.some(
      (r) => r.resourceId === resourceId && r.kind === "knowledge",
    )
  )
    throw Error("BLK-CONVERT-002");
  const source = snapshot.files.find((f) =>
    f.path.endsWith("bm25_retriever.py"),
  )!;
  const lines = source.content.split(/\r?\n/);
  const lineStart =
    lines.findIndex((line) => line.startsWith("class InMemoryBM25Retriever")) +
    1;
  if (!lineStart || !lines.some((line) => /^    def run\(/.test(line)))
    throw Error("BLK-CONVERT-001");
  const blockId = `block-${crypto.randomUUID()}`;
  const patch = await makePatch(
    project,
    [
      {
        op: "block.add",
        moduleId,
        blockId,
        payload: {
          type: "core.knowledge.retrieve",
          id: blockId,
          fields: { RESOURCE: resourceId },
          x: 420,
          y: 100,
        },
      },
    ],
    userRegistry,
  );
  signal.throwIfAborted();
  return {
    schemaVersion: "blocky.conversion/v1alpha1" as const,
    candidateId: `candidate-${crypto.randomUUID()}`,
    artifactType: "blueprint" as const,
    displayName: "资料查询",
    rationale:
      "源码的查询与文档返回接口可映射为通用查找资料积木，查询算法保留在原生实现范围。",
    source: {
      repository: snapshot.repository,
      commit: snapshot.commit,
      version: snapshot.version,
      license: snapshot.license,
      snapshotId: snapshot.snapshotId,
    },
    dependencies: {
      manifest: snapshot.dependencyManifest,
      sha256: snapshot.files.find(
        (f) => f.path === snapshot.dependencyManifest,
      )!.sha256,
      resolution: "declarations-only",
      installed: false,
    },
    evidence: [
      {
        file: source.path,
        sha256: source.sha256,
        lineStart,
        lineEnd: lineStart + 4,
        excerpt: lines.slice(lineStart - 1, lineStart + 4).join("\n"),
        mapsTo: "core.knowledge.retrieve",
      },
    ],
    retained: [
      "BM25 打分、top_k、过滤策略与分数缩放未转换",
      "未导入 Document Store 或执行上游代码",
      "上游依赖只锁定声明文件，未解析或安装依赖",
      "插入后需连接到交互流程；当前资源使用项目选择的检索实现",
    ],
    buildSpec: {
      schemaVersion: "blocky.build/v1alpha1",
      requestId: `request-${crypto.randomUUID()}`,
      projectId: project.manifest.projectId,
      baseDigest: await projectDigest(project),
      intent: "将资料查询接口映射为可编辑积木",
      targetModuleIds: [moduleId],
      requiredResources: project.manifest.resources.filter(
        (r) => r.resourceId === resourceId,
      ),
      requestedCapabilities: patch.permissionDelta,
      acceptanceCriteria: [
        "来源与许可证可定位",
        "新增积木可编译",
        "拒绝不改变项目",
        "接受后可以整体撤销",
      ],
    },
    patch,
  };
}
