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
  /^\d{4}-\d\d-\d\dT\S+ INFO tauri-service:service: \[Tauri:Frontend:\d+\] \[WDIO Tauri Plugin\] (?:TEST: This is a test (?:INFO|WARN) log after setupConsoleForwarding\(\)|⚠️ Invoke interception via defineProperty failed; mock routing via window\.__wdio_mocks__ remains active)$/u;
const providerCleanupDiagnostic =
  /^\d{4}-\d\d-\d\dT\S+ WARN tauri-service:service: Failed to clear mock store: Error: A sessionId is required for this command$/u;
const credentialField =
  /(?:^|[{\s,])["']?(?:api[_-]?key|authorization|bearer|password|secret|token)["']?\s*[:=]\s*(?!["']?(?:<redacted>|undefined|null)["']?(?:[,}\s]|$))(?:"[^"\r\n]+"|'[^'\r\n]+'|[^\s,}"']+)/iu;
const sensitiveValueDetectors = [
  ["model-token", /\bsk-(?:[A-Za-z0-9_-]{20,})\b/u],
  ["github-token", /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/u],
  ["aws-access-key", /\bAKIA[A-Z0-9]{16}\b/u],
  ["bearer-token", /\bBearer\s+[A-Za-z0-9._~+/-]{8,}\b/iu],
  ["pem-private-key", /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/u],
  ["cookie", /(?:^|[;\s])(?:set-)?cookie\s*:\s*[^\s;=]+=[^\s;]+/iu],
  ["windows-absolute-path", /(?:^|[^A-Za-z0-9_])[A-Za-z]:\\(?:[^\s\\/:*?"<>|]+\\)*[^\s\\/:*?"<>|]+/u],
  ["unix-absolute-path", /(?:^|[^A-Za-z0-9_])file=\/(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+|(?:^|[^:/A-Za-z0-9_])\/(?:var|tmp|home|usr|etc|opt|mnt|workspace)(?:\/[A-Za-z0-9._-]+)+/iu],
];
const timestampedSeverity =
  /^\d{4}-\d\d-\d\dT\S+\s+(?:ERROR|WARN)\b/u;
const embeddedSeverity = /\[(?:ERROR|WARN)\]/u;
const runtimeFailure =
  /\b(?:unhandled|panic|fatal|TypeError|ReferenceError|SyntaxError|BLOCKY_APP_ERROR)\b/u;

function providerCategory(line) {
  if (providerJsonDiagnostic.test(line)) return "jsonNullExpectedU32";
  if (providerPluginDiagnostic.test(line)) return "pluginSelfDiagnostic";
  if (providerCleanupDiagnostic.test(line)) return "afterSessionCleanup";
  return null;
}

function applicationCategory(line) {
  if (timestampedSeverity.test(line)) {
    return line.includes(" ERROR ") ? "application-error" : "application-warning";
  }
  if (embeddedSeverity.test(line)) {
    return line.includes("[ERROR]") ? "application-error" : "application-warning";
  }
  return runtimeFailure.test(line) ? "runtime-failure" : null;
}

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
  let providerCleanupContinuation = false;
  for (const [index, line] of content.split(/\r?\n/u).entries()) {
    const lineNumber = index + 1;
    const sensitiveCategories = new Set();
    if (credentialField.test(line)) sensitiveCategories.add("credential-field");
    for (const [category, detector] of sensitiveValueDetectors) {
      if (detector.test(line)) sensitiveCategories.add(category);
    }
    for (const category of sensitiveCategories) {
      summary.sensitiveMatches.push({ file: name, line: lineNumber, category });
    }

    if (/^\d{4}-\d\d-\d\dT/u.test(line)) providerCleanupContinuation = false;
    const knownProviderCategory = providerCategory(line);
    const knownApplicationCategory = applicationCategory(line);
    if (knownApplicationCategory && !knownProviderCategory) {
      summary.applicationDiagnostics.push({
        file: name,
        line: lineNumber,
        category: knownApplicationCategory,
      });
      continue;
    }
    if (knownProviderCategory) {
      summary.providerDiagnostics[knownProviderCategory] += 1;
      providerCleanupContinuation = knownProviderCategory === "afterSessionCleanup";
      continue;
    }
    if (providerCleanupContinuation && (/^\s+at /u.test(line) || line === "")) {
      continue;
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
