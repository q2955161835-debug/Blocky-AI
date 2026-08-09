import {
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { relative, resolve } from "node:path";

const workspace = resolve(process.cwd());
const userHome = process.env.USERPROFILE ? resolve(process.env.USERPROFILE) : null;
const artifactDirectory = resolve(workspace, "artifacts", "wdio");
const summaryPath = resolve(artifactDirectory, "audit-summary.json");

function escapePattern(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function listFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? listFiles(path) : [path];
  });
}

function pathVariants(path) {
  return [path, path.replaceAll("\\", "/")];
}

function sanitize(content) {
  // WDIO can leave NUL padding when two logger handles truncate/reopen wdio.log.
  // Removing only padding bytes preserves every textual diagnostic line.
  let sanitized = content.replaceAll("\0", "");
  for (const [path, replacement] of [
    [workspace, "<WORKSPACE>"],
    [userHome, "<USER_HOME>"],
  ]) {
    if (!path) continue;
    for (const variant of pathVariants(path)) {
      sanitized = sanitized.replace(
        new RegExp(escapePattern(variant), "giu"),
        replacement,
      );
    }
  }
  return sanitized;
}

const providerJsonDiagnostic =
  /^\d{4}-\d\d-\d\dT\S+ INFO tauri-service:service: \[Tauri:Frontend:\d+\] JSON error: invalid type: null, expected u32 at line 1 column \d+$/u;
const providerPluginDiagnostic =
  /\[WDIO Tauri Plugin\] (?:TEST: This is a test (?:INFO|WARN) log after setupConsoleForwarding\(\)|⚠️ Invoke interception via defineProperty failed; mock routing via window\.__wdio_mocks__ remains active)$/u;
const providerCleanupDiagnostic =
  /WARN tauri-service:service: Failed to clear mock store: Error: A sessionId is required for this command$/u;
const sensitiveValue =
  /\b(?:api[_-]?key|authorization|bearer|password|secret|token)\b\s*[:=]\s*(?!<redacted>|undefined|null)["']?[^\s,"'}]+/giu;
const timestampedSeverity =
  /^\d{4}-\d\d-\d\dT\S+\s+(?:ERROR|WARN)\b/u;
const embeddedSeverity = /\[(?:ERROR|WARN)\]/u;
const runtimeFailure =
  /\b(?:unhandled|panic|fatal|TypeError|ReferenceError|SyntaxError|BLOCKY_APP_ERROR)\b/u;

const files = listFiles(artifactDirectory).filter((path) => path !== summaryPath);
if (files.length === 0) throw new Error("WDIO_LOG_AUDIT_NO_ARTIFACTS");

const summary = {
  files: [],
  providerDiagnostics: {
    jsonNullExpectedU32: 0,
    pluginSelfDiagnostic: 0,
    afterSessionCleanup: 0,
  },
  applicationDiagnostics: [],
  sensitiveMatches: [],
  absoluteWorkspaceMatches: [],
};

for (const path of files) {
  if (!statSync(path).isFile()) continue;
  const name = relative(artifactDirectory, path).replaceAll("\\", "/");
  let content = readFileSync(path, "utf8");
  content = sanitize(content);
  writeFileSync(path, content, "utf8");
  summary.files.push(name);

  for (const variant of pathVariants(workspace)) {
    if (content.toLocaleLowerCase().includes(variant.toLocaleLowerCase())) {
      summary.absoluteWorkspaceMatches.push({ file: name });
    }
  }
  for (const match of content.matchAll(sensitiveValue)) {
    const line = content.slice(0, match.index).split(/\r?\n/u).length;
    summary.sensitiveMatches.push({ file: name, line });
  }

  let providerCleanupContinuation = false;
  for (const [index, line] of content.split(/\r?\n/u).entries()) {
    if (providerJsonDiagnostic.test(line)) {
      summary.providerDiagnostics.jsonNullExpectedU32 += 1;
      continue;
    }
    if (providerPluginDiagnostic.test(line)) {
      summary.providerDiagnostics.pluginSelfDiagnostic += 1;
      continue;
    }
    if (providerCleanupDiagnostic.test(line)) {
      summary.providerDiagnostics.afterSessionCleanup += 1;
      providerCleanupContinuation = true;
      continue;
    }
    if (providerCleanupContinuation && (/^\s+at /u.test(line) || line === "")) {
      continue;
    }
    if (/^\d{4}-\d\d-\d\dT/u.test(line)) providerCleanupContinuation = false;

    if (
      timestampedSeverity.test(line) ||
      embeddedSeverity.test(line) ||
      runtimeFailure.test(line)
    ) {
      summary.applicationDiagnostics.push({ file: name, line: index + 1 });
    }
  }
}

summary.files.sort();
writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

if (
  summary.applicationDiagnostics.length > 0 ||
  summary.sensitiveMatches.length > 0 ||
  summary.absoluteWorkspaceMatches.length > 0
) {
  throw new Error(`WDIO_LOG_AUDIT_FAILED:${JSON.stringify(summary)}`);
}

process.stdout.write(`${JSON.stringify(summary)}\n`);
