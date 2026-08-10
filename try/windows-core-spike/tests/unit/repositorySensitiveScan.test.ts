import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

type ScanTarget = "tracked" | "snapshot" | "frontend_log" | "backend_log";

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

function runScan(mutation?: { target: ScanTarget; value: string }) {
  const artifactParent = resolve(process.cwd(), "artifacts");
  mkdirSync(artifactParent, { recursive: true });
  const sandbox = mkdtempSync(resolve(artifactParent, "security-scan-unit-"));
  const sourceRoot = resolve(sandbox, "tracked");
  const artifactRoot = resolve(sandbox, "security-scan");
  mkdirSync(sourceRoot, { recursive: true });
  mkdirSync(artifactRoot, { recursive: true });

  const trackedPath = resolve(sourceRoot, "sample.ts");
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
    writeFileSync(
      paths[target],
      mutation?.target === target ? mutation.value : safeFiles[target],
      "utf8",
    );
  }

  try {
    const execution = spawnSync(
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
    return execution;
  } finally {
    rmSync(sandbox, { force: true, recursive: true });
  }
}

describe("repository sensitive scan", () => {
  it("scans all four targets without self-triggering", () => {
    const result = runScan();

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(
      "SENSITIVE_SCAN tracked=0 snapshot=0 frontend_log=0 backend_log=0",
    );
    expect(result.stderr).toBe("");
  });

  it.each(sensitiveCases)(
    "rejects $category in $target without echoing the matched value",
    ({ category, value, target }) => {
      const result = runScan({ target, value });
      const output = `${result.stdout}${result.stderr}`;

      expect(result.status).not.toBe(0);
      expect(output).toContain(`${target}=1`);
      expect(output).toContain(category);
      expect(output).not.toContain(value);
    },
    15_000,
  );
});
