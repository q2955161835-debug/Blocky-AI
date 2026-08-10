import { spawnSync } from "node:child_process";
import {
  readFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

type ScanTarget = "tracked" | "snapshot" | "frontend_log" | "backend_log";
type FileContent = string | Uint8Array;

interface ScanMutation {
  readonly target: ScanTarget;
  readonly value: FileContent;
  readonly trackedFileName?: string;
  readonly compileTrackedTypeScript?: boolean;
  readonly literalContent?: boolean;
}

const safeFiles: Record<ScanTarget, string> = {
  tracked: "export const status = 'safe';\n",
  snapshot: `${JSON.stringify({ schemaVersion: "blocky.spike-project/v1" })}\n`,
  frontend_log: "frontend completed without diagnostics\n",
  backend_log: "backend completed without diagnostics\n",
};

const sensitiveCases: ReadonlyArray<{
  readonly category: string;
  readonly value: string;
  readonly target: ScanTarget;
}> = [
  { category: "model-token", value: ["sk", "-", "test", "A".repeat(24)].join(""), target: "tracked" },
  { category: "github-token", value: ["gh", "p", "_", "B".repeat(24)].join(""), target: "snapshot" },
  { category: "aws-access-key", value: ["AK", "IA", "C".repeat(16)].join(""), target: "frontend_log" },
  { category: "bearer-token", value: ["Bear", "er ", "D".repeat(12)].join(""), target: "backend_log" },
  { category: "pem-private-key", value: ["-----BEGIN ", "PRIVATE KEY-----"].join(""), target: "tracked" },
  { category: "cookie", value: ["set-", "cookie: session=", "E".repeat(12)].join(""), target: "snapshot" },
  { category: "windows-absolute-path", value: ["C", ":\\", "private", "\\", "file.txt"].join(""), target: "frontend_log" },
  { category: "unix-absolute-path", value: ["/", "home", "/private/file.txt"].join(""), target: "backend_log" },
];

function runScan(mutation?: ScanMutation) {
  const artifactParent = resolve(process.cwd(), "artifacts");
  mkdirSync(artifactParent, { recursive: true });
  const sandbox = mkdtempSync(resolve(artifactParent, "security-scan-unit-"));
  const sourceRoot = resolve(sandbox, "tracked");
  const artifactRoot = resolve(sandbox, "security-scan");
  mkdirSync(sourceRoot, { recursive: true });
  mkdirSync(artifactRoot, { recursive: true });

  const trackedPath = resolve(
    sourceRoot,
    mutation?.target === "tracked" && mutation.trackedFileName
      ? mutation.trackedFileName
      : "sample.ts",
  );
  const trackedListPath = resolve(sandbox, "tracked-files.txt");
  const paths: Record<Exclude<ScanTarget, "tracked">, string> = {
    snapshot: resolve(artifactRoot, "project-snapshot.json"),
    frontend_log: resolve(artifactRoot, "frontend.log"),
    backend_log: resolve(artifactRoot, "backend.log"),
  };
  writeFileSync(trackedListPath, `${trackedPath}\n`, "utf8");
  writeFileSync(
    trackedPath,
    mutation?.target === "tracked" ? mutation.value : safeFiles.tracked,
    "utf8",
  );
  for (const target of ["snapshot", "frontend_log", "backend_log"] as const) {
    const mutationValue = mutation?.target === target ? mutation.value : undefined;
    const content = target === "snapshot"
      && typeof mutationValue === "string"
      && !mutation?.literalContent
      ? `${JSON.stringify({ value: mutationValue })}\n`
      : (mutationValue ?? safeFiles[target]);
    writeFileSync(
      paths[target],
      content,
      "utf8",
    );
  }

  try {
    const scan = spawnSync(
      "pwsh",
      [
        "-NoProfile",
        "-File",
        resolve(process.cwd(), "tests", "security", "repository-sensitive-scan.ps1"),
        "-RepositoryRoot",
        sandbox,
        "-ArtifactRoot",
        artifactRoot,
        "-TrackedListPath",
        trackedListPath,
      ],
      { cwd: process.cwd(), encoding: "utf8" },
    );
    const compiler = mutation?.compileTrackedTypeScript
      ? spawnSync(
          process.execPath,
          [
            resolve(process.cwd(), "node_modules", "typescript", "lib", "tsc.js"),
            "--ignoreConfig",
            "--noEmit",
            "--target",
            "ES2022",
            trackedPath,
          ],
          { cwd: sourceRoot, encoding: "utf8" },
        )
      : undefined;
    return { scan, compiler };
  } finally {
    rmSync(sandbox, { force: true, recursive: true });
  }
}

describe("repository sensitive scan", () => {
  it("scans all four targets without self-triggering", () => {
    const { scan } = runScan();

    expect(scan.status).toBe(0);
    expect(scan.stdout.trim()).toBe(
      "SENSITIVE_SCAN tracked=0 snapshot=0 frontend_log=0 backend_log=0",
    );
    expect(scan.stderr).toBe("");
  });

  it.each(sensitiveCases)(
    "rejects $category in $target without echoing the matched value",
    ({ category, value, target }) => {
      const { scan } = runScan({ target, value });
      const output = `${scan.stdout}${scan.stderr}`;

      expect(scan.status).not.toBe(0);
      expect(output).toContain(`${target}=1`);
      expect(output).toContain(category);
      expect(output).not.toContain(value);
    },
    15_000,
  );

  it("fails closed on NUL-bearing TypeScript that the pinned compiler accepts", () => {
    const value = ["sk", "-", "test", "N".repeat(24)].join("");
    const source = Buffer.from(
      `export const sample = "prefix\0${value}";\n`,
      "utf8",
    );
    const { scan, compiler } = runScan({
      target: "tracked",
      value: source,
      compileTrackedTypeScript: true,
    });
    const output = `${scan.stdout}${scan.stderr}`;

    expect(compiler?.status).toBe(0);
    expect(scan.status).not.toBe(0);
    expect(output).toContain("unsafe-text-nul");
    expect(output).toContain("model-token");
    expect(output).not.toContain(value);
  });

  it("scans parsed JSON string values containing an escaped NUL", () => {
    const value = ["sk", "-", "test", "J".repeat(24)].join("");
    const json = `{"sample":"prefix\\u0000${value}"}\n`;
    const { scan } = runScan({
      target: "snapshot",
      value: json,
      literalContent: true,
    });
    const output = `${scan.stdout}${scan.stderr}`;

    expect(() => JSON.parse(json)).not.toThrow();
    expect(scan.status).not.toBe(0);
    expect(output).toContain("unsafe-text-nul");
    expect(output).toContain("model-token");
    expect(output).not.toContain(value);
  });

  it.each([
    {
      encoding: "UTF-16LE BOM",
      bytes: (value: string) => Buffer.concat([
        Buffer.from([0xff, 0xfe]),
        Buffer.from(value, "utf16le"),
      ]),
    },
    {
      encoding: "UTF-16BE BOM",
      bytes: (value: string) => {
        const littleEndian = Buffer.from(value, "utf16le");
        for (let index = 0; index < littleEndian.length; index += 2) {
          [littleEndian[index], littleEndian[index + 1]] = [
            littleEndian[index + 1],
            littleEndian[index],
          ];
        }
        return Buffer.concat([Buffer.from([0xfe, 0xff]), littleEndian]);
      },
    },
  ])("decodes $encoding tracked text before scanning", ({ bytes }) => {
    const value = ["sk", "-", "test", "U".repeat(24)].join("");
    const { scan } = runScan({
      target: "tracked",
      trackedFileName: "sample.md",
      value: bytes(`credential=${value}\n`),
    });
    const output = `${scan.stdout}${scan.stderr}`;

    expect(scan.status).not.toBe(0);
    expect(output).toContain("model-token");
    expect(output).not.toContain(value);
  });

  it("fails closed with a fixed category when tracked text cannot be decoded", () => {
    const { scan } = runScan({
      target: "tracked",
      trackedFileName: "sample.ts",
      value: Buffer.from([0xc3, 0x28]),
    });

    expect(scan.status).not.toBe(0);
    expect(`${scan.stdout}${scan.stderr}`).toContain("text-decoding-error");
  });

  it("fails closed when JSON cannot be parsed", () => {
    const { scan } = runScan({
      target: "snapshot",
      value: '{"schemaVersion":',
      literalContent: true,
    });

    expect(scan.status).not.toBe(0);
    expect(`${scan.stdout}${scan.stderr}`).toContain("invalid-json");
  });

  it("skips a real PNG binary without scanning or echoing appended bytes", () => {
    const value = ["sk", "-", "test", "P".repeat(24)].join("");
    const png = readFileSync(
      resolve(process.cwd(), "src-tauri", "icons", "32x32.png"),
    );
    const { scan } = runScan({
      target: "tracked",
      trackedFileName: "asset.png",
      value: Buffer.concat([png, Buffer.from(`\n${value}`, "utf8")]),
    });
    const output = `${scan.stdout}${scan.stderr}`;

    expect(scan.status).toBe(0);
    expect(output).toContain("SENSITIVE_SCAN tracked=0");
    expect(output).not.toContain(value);
  });
});
