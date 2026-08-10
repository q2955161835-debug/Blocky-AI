import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

interface AuditFinding {
  readonly file: string;
  readonly line: number;
  readonly category: string;
}

interface AuditSummary {
  readonly providerDiagnostics: {
    readonly jsonNullExpectedU32: number;
    readonly pluginSelfDiagnostic: number;
    readonly afterSessionCleanup: number;
  };
  readonly applicationDiagnostics: readonly AuditFinding[];
  readonly sensitiveMatches: readonly AuditFinding[];
}

function runAudit(lines: readonly string[]): {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly summary: AuditSummary;
} {
  const artifactRoot = resolve(process.cwd(), "artifacts");
  mkdirSync(artifactRoot, { recursive: true });
  const sandbox = mkdtempSync(resolve(artifactRoot, "audit-wdio-unit-"));
  if (dirname(sandbox) !== artifactRoot) {
    throw new Error("WDIO_AUDIT_TEST_PATH_OUTSIDE_ARTIFACT_ROOT");
  }
  const logDirectory = resolve(sandbox, "artifacts", "wdio");
  mkdirSync(logDirectory, { recursive: true });
  writeFileSync(resolve(logDirectory, "probe.log"), `${lines.join("\n")}\n`, "utf8");

  try {
    const execution = spawnSync(
      process.execPath,
      [resolve(process.cwd(), "scripts", "audit-wdio-logs.mjs")],
      { cwd: sandbox, encoding: "utf8" },
    );
    const summary = JSON.parse(
      readFileSync(resolve(logDirectory, "audit-summary.json"), "utf8"),
    ) as AuditSummary;
    return {
      status: execution.status,
      stdout: execution.stdout,
      stderr: execution.stderr,
      summary,
    };
  } finally {
    rmSync(sandbox, { force: true, recursive: true });
  }
}

describe("WDIO artifact audit", () => {
  it("allows only complete known provider diagnostic lines", () => {
    const result = runAudit([
      "2026-08-10T00:04:05.432Z INFO tauri-service:service: [Tauri:Frontend:0] [WDIO Tauri Plugin] ⚠️ Invoke interception via defineProperty failed; mock routing via window.__wdio_mocks__ remains active",
      "2026-08-10T00:04:05.434Z INFO tauri-service:service: [Tauri:Frontend:0] [WDIO Tauri Plugin] TEST: This is a test WARN log after setupConsoleForwarding()",
      "2026-08-10T00:04:11.667Z INFO tauri-service:service: [Tauri:Frontend:0] JSON error: invalid type: null, expected u32 at line 1 column 222",
      "2026-08-10T00:04:26.297Z WARN tauri-service:service: Failed to clear mock store: Error: A sessionId is required for this command",
    ]);

    expect(result.status).toBe(0);
    expect(result.summary.providerDiagnostics).toEqual({
      jsonNullExpectedU32: 1,
      pluginSelfDiagnostic: 2,
      afterSessionCleanup: 1,
    });
    expect(result.summary.applicationDiagnostics).toEqual([]);
  });

  it.each([
    "2026-08-10T00:05:00.000Z ERROR blocky-app: unhandled reviewer mutation",
    "2026-08-10T00:05:00.000Z ERROR blocky-app: [WDIO Tauri Plugin] TEST: This is a test WARN log after setupConsoleForwarding()",
  ])("rejects application diagnostics without provider suffix exemptions: %s", (line) => {
    const result = runAudit([line]);

    expect(result.status).not.toBe(0);
    expect(result.summary.providerDiagnostics.pluginSelfDiagnostic).toBe(0);
    expect(result.summary.applicationDiagnostics).toEqual([
      { file: "probe.log", line: 1, category: "application-error" },
    ]);
  });

  it("detects quoted JSON credential fields without echoing their values", () => {
    const secretValue = ["reviewer", "secret", "value"].join("-");
    const line = `2026-08-10T00:05:00.000Z INFO blocky-app: ${JSON.stringify({ token: secretValue })}`;
    const result = runAudit([line]);

    expect(result.status).not.toBe(0);
    expect(result.summary.sensitiveMatches).toEqual([
      { file: "probe.log", line: 1, category: "credential-field" },
    ]);
    expect(`${JSON.stringify(result.summary)}${result.stdout}${result.stderr}`)
      .not.toContain(secretValue);
  });

  it("uses the shared security scanner category names for value detectors", () => {
    const modelToken = ["sk", "-", "test", "A".repeat(24)].join("");
    const result = runAudit([
      `2026-08-10T00:05:00.000Z INFO blocky-app: model output ${modelToken}`,
    ]);

    expect(result.status).not.toBe(0);
    expect(result.summary.sensitiveMatches).toEqual([
      { file: "probe.log", line: 1, category: "model-token" },
    ]);
    expect(`${JSON.stringify(result.summary)}${result.stdout}${result.stderr}`)
      .not.toContain(modelToken);
  });
});
