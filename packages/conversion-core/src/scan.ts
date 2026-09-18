import { digest } from "@blocky/language-schema";
import { analyzeFile, type FileAnalysis } from "./analyze";
import {
  artifactSchema,
  pageSchema,
  verifyFile,
  type SourceArtifact,
} from "./snapshot";
import {
  dependencyFile,
  inspectLicense,
  licenseFile,
  type LicenseEvidence,
} from "./license";
export type ConversionCall = (
  operation: string,
  fields: Record<string, unknown>,
) => Promise<unknown>;
const ANALYZER = "lezer-numeric-v1.0.0";
type Cached = { key: string; analysis: FileAnalysis; digest: string };
export type ConversionReport = {
  schemaVersion: "blocky.conversion-plan/v1";
  artifact: SourceArtifact;
  analyzer: string;
  files: (FileAnalysis & { sha256: string; bytes: number })[];
  licenses: LicenseEvidence[];
  licenseStatus: string;
  dependencies: { file: string; sha256: string; locked: boolean }[];
  evidenceMap: {
    schemaVersion: "blocky.conversion-evidence/v1";
    entries: {
      file: string;
      sha256: string;
      symbol: string;
      lineStart: number;
      lineEnd: number;
      decision: string;
    }[];
  };
  compatibilityReport: {
    schemaVersion: "blocky.compatibility-report/v1";
    executedUpstream: false;
    retained: string[];
  };
  performanceBudget: {
    maxFiles: number;
    maxSourceBytes: number;
    maxFileBytes: number;
    maxAnalysisBytes: number;
  };
  workingTree: {
    dirty: string;
    scope: string;
    checked: number;
    changed: number;
    unchecked: number;
  };
  stats: {
    analyzed: number;
    reused: number;
    sourceBytes: number;
    elapsedMs: number;
  };
  excluded: { path: string; reason: string }[];
  excludedCount: number;
  excludedTruncated: boolean;
  changes: {
    added: string[];
    changed: string[];
    removed: string[];
    baselineSnapshotId?: string;
    projectModified: false;
  };
};
export class ConversionScanner {
  constructor(
    private call: ConversionCall,
    private projectId: string,
  ) {}
  private invoke(operation: string, fields: Record<string, unknown> = {}) {
    return this.call(operation, { projectId: this.projectId, ...fields });
  }
  async scan(
    options: { path?: string; ref?: string; subdir?: string },
    signal?: AbortSignal,
  ) {
    signal?.throwIfAborted();
    const cancel = () => {
      void this.cancel().catch(() => {});
    };
    signal?.addEventListener("abort", cancel, { once: true });
    try {
      const artifact = artifactSchema.parse(
        await this.invoke("conversion-scan", options),
      );
      signal?.throwIfAborted();
      return artifact;
    } finally {
      signal?.removeEventListener("abort", cancel);
    }
  }
  cancel() {
    return this.invoke("conversion-cancel");
  }
  async analyze(
    input: SourceArtifact,
    signal = new AbortController().signal,
    progress?: (count: number, total: number) => void,
  ) {
    const start = performance.now(),
      artifact = artifactSchema.parse(input);
    const saved = (await this.invoke("conversion-cache-load", {
      snapshotId: artifact.snapshotId,
    })) as {
      value?: unknown;
      analysisCache?: {
        version?: string;
        entries?: Cached[];
        baseline?: { snapshotId: string; files: Record<string, string> };
      };
    };
    const cache = new Map<string, Cached>();
    if (
      saved.analysisCache?.version === ANALYZER &&
      Array.isArray(saved.analysisCache.entries)
    )
      for (const entry of saved.analysisCache.entries.slice(0, 20000))
        if (
          entry &&
          typeof entry.key === "string" &&
          entry.digest === (await digest(entry.analysis))
        )
          cache.set(entry.key, entry);
    const previous =
      saved.analysisCache?.version === ANALYZER
        ? saved.analysisCache.baseline
        : undefined;
    const files: ConversionReport["files"] = [],
      licenses: LicenseEvidence[] = [],
      dependencies: ConversionReport["dependencies"] = [];
    const nextCache: Cached[] = [],
      paths = new Set<string>();
    let cursor: number | undefined,
      analyzed = 0,
      reused = 0,
      sourceBytes = 0;
    let first: ReturnType<typeof pageSchema.parse> | undefined;
    do {
      signal.throwIfAborted();
      const page = pageSchema.parse(
        await this.invoke("conversion-read", {
          artifactId: artifact.artifactId,
          ...(cursor === undefined ? {} : { cursor }),
        }),
      );
      for (const key of [
        "snapshotId",
        "commit",
        "artifactId",
        "sha256",
        "bytes",
        "subdir",
        "repository",
        "dirty",
      ] as const)
        if (page[key] !== artifact[key]) throw Error("BLK-CONVERT-CORRUPT");
      first ??= page;
      for (const file of page.files) {
        signal.throwIfAborted();
        if (paths.has(file.path)) throw Error("BLK-CONVERT-CORRUPT");
        paths.add(file.path);
        sourceBytes += file.bytes;
        if (sourceBytes > 100 * 1024 * 1024 || paths.size > artifact.fileCount)
          throw Error("BLK-CONVERT-LIMIT");
        await verifyFile(file);
        if (licenseFile(file.path)) licenses.push(inspectLicense(file));
        if (dependencyFile(file.path))
          dependencies.push({
            file: file.path,
            sha256: file.sha256,
            locked: /lock|go\.sum/.test(file.path),
          });
        const key = `${ANALYZER}:${file.path}:${file.sha256}`,
          hit = cache.get(key);
        const analysis = hit
          ? hit.analysis
          : analyzeFile(file.path, file.content);
        if (hit) reused++;
        else analyzed++;
        const entry = { key, analysis, digest: await digest(analysis) };
        nextCache.push(entry);
        files.push({ ...analysis, sha256: file.sha256, bytes: file.bytes });
      }
      progress?.(files.length, artifact.fileCount);
      const partial = {
        version: ANALYZER,
        entries: nextCache,
        ...(previous ? { baseline: previous } : {}),
      };
      if (
        new TextEncoder().encode(JSON.stringify(partial)).length >
        7 * 1024 * 1024
      )
        throw Error("BLK-CONVERT-LIMIT");
      await this.invoke("conversion-cache-save", {
        snapshotId: artifact.snapshotId,
        value: null,
        analysisCache: partial,
      });
      if (
        page.nextCursor !== null &&
        (page.nextCursor <= (cursor ?? 0) || !page.files.length)
      )
        throw Error("BLK-CONVERT-CORRUPT");
      cursor = page.nextCursor ?? undefined;
      await new Promise((resolve) => setTimeout(resolve, 0));
    } while (cursor !== undefined);
    if (!first || files.length !== artifact.fileCount)
      throw Error("BLK-CONVERT-CORRUPT");
    const licenseStatus =
      licenses.some(
        (l) => l.detected === "unverified" && !/notice/i.test(l.file),
      ) || !licenses.some((l) => l.detected !== "unverified")
        ? "unverified"
        : [
            ...new Set(
              licenses
                .filter((l) => l.detected !== "unverified")
                .map((l) => l.detected),
            ),
          ].join(" + ");
    const hashes = Object.fromEntries(files.map((f) => [f.path, f.sha256]));
    const report: ConversionReport = {
      schemaVersion: "blocky.conversion-plan/v1",
      artifact,
      analyzer: ANALYZER,
      files,
      licenses,
      licenseStatus,
      dependencies,
      evidenceMap: {
        schemaVersion: "blocky.conversion-evidence/v1",
        entries: files.flatMap((f) =>
          f.symbols.map((s) => ({
            file: f.path,
            sha256: f.sha256,
            symbol: s.name,
            lineStart: s.lineStart,
            lineEnd: s.lineEnd,
            decision: s.decision,
          })),
        ),
      },
      compatibilityReport: {
        schemaVersion: "blocky.compatibility-report/v1",
        executedUpstream: false,
        retained: [
          "未执行或安装上游代码；依赖仅保存声明与锁文件证据。",
          "原生保留和兼容草案不可作为运行产物。",
          "仅封闭纯数值函数可生成计算积木；其他算法、状态、网络和外部依赖不作等价承诺。",
        ],
      },
      performanceBudget: {
        maxFiles: 20000,
        maxSourceBytes: 100 * 1024 * 1024,
        maxFileBytes: 2 * 1024 * 1024,
        maxAnalysisBytes: 16 * 1024 * 1024,
      },
      workingTree: {
        dirty: first.dirty,
        scope: first.dirtyScope,
        checked: first.dirtyChecked,
        changed: first.dirtyChanged,
        unchecked: first.dirtyUnchecked,
      },
      stats: {
        analyzed,
        reused,
        sourceBytes,
        elapsedMs: performance.now() - start,
      },
      excluded: first.excluded,
      excludedCount: first.excludedCount,
      excludedTruncated: first.excludedTruncated,
      changes: {
        added: files.filter((f) => !previous?.files[f.path]).map((f) => f.path),
        changed: files
          .filter(
            (f) =>
              previous?.files[f.path] && previous.files[f.path] !== f.sha256,
          )
          .map((f) => f.path),
        removed: Object.keys(previous?.files ?? {}).filter(
          (p) => !paths.has(p),
        ),
        ...(previous ? { baselineSnapshotId: previous.snapshotId } : {}),
        projectModified: false,
      },
    };
    signal.throwIfAborted();
    await this.invoke("conversion-cache-save", {
      snapshotId: artifact.snapshotId,
      value: report,
      analysisCache: {
        version: ANALYZER,
        entries: nextCache,
        baseline: { snapshotId: artifact.snapshotId, files: hashes },
      },
    });
    return report;
  }
  async source(artifact: SourceArtifact, path: string, signal?: AbortSignal) {
    artifact = artifactSchema.parse(artifact);
    let cursor: number | undefined;
    do {
      signal?.throwIfAborted();
      const page = pageSchema.parse(
        await this.invoke("conversion-read", {
          artifactId: artifact.artifactId,
          ...(cursor === undefined ? {} : { cursor }),
        }),
      );
      for (const key of ["snapshotId", "commit", "artifactId", "sha256", "bytes", "subdir", "repository", "dirty"] as const)
        if (page[key] !== artifact[key]) throw Error("BLK-CONVERT-CORRUPT");
      const file = page.files.find((f) => f.path === path);
      if (file) {
        await verifyFile(file);
        return file;
      }
      if (page.nextCursor !== null && page.nextCursor <= (cursor ?? 0))
        throw Error("BLK-CONVERT-CORRUPT");
      cursor = page.nextCursor ?? undefined;
    } while (cursor !== undefined);
    throw Error("BLK-CONVERT-MISSING");
  }
}
