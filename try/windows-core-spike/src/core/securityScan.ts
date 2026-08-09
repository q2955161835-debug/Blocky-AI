import { canonicalizeJson, type JsonValue } from "./json";

export type SensitiveValueKind =
  | "model-token"
  | "github-token"
  | "aws-access-key"
  | "bearer-token"
  | "pem-private-key"
  | "cookie"
  | "windows-absolute-path"
  | "unix-absolute-path";

export interface SensitiveValueFinding {
  path: string;
  kind: SensitiveValueKind;
}

const DETECTORS: ReadonlyArray<readonly [SensitiveValueKind, RegExp]> = [
  ["model-token", /\bsk-(?:[A-Za-z0-9_-]{20,})\b/],
  ["github-token", /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/],
  ["aws-access-key", /\bAKIA[A-Z0-9]{16}\b/],
  ["bearer-token", /\bBearer\s+[A-Za-z0-9._~+/-]{8,}\b/i],
  ["pem-private-key", /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/],
  ["cookie", /(?:^|[;\s])(?:set-)?cookie\s*:\s*[^\s;=]+=[^\s;]+/i],
  ["windows-absolute-path", /(?<![A-Za-z0-9_])[A-Za-z]:\\(?:[^\s\\]+\\)*[^\s\\]+/],
  ["unix-absolute-path", /(?:^|[^A-Za-z0-9_])file=\/(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+|(?<![:A-Za-z0-9_])\/(?:var|tmp|home|usr|etc|opt|mnt)(?:\/[A-Za-z0-9._-]+)+|(?<![:A-Za-z0-9_])\/(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]*\.[A-Za-z0-9._-]+/i],
];

function sensitiveKind(value: string): SensitiveValueKind | undefined {
  return DETECTORS.find(([, expression]) => expression.test(value))?.[0];
}

function propertyPath(parent: string, key: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? `${parent}.${key}` : `${parent}[${JSON.stringify(key)}]`;
}

function scan(value: JsonValue, path: string, findings: SensitiveValueFinding[]): void {
  if (typeof value === "string") {
    const kind = sensitiveKind(value);
    if (kind) findings.push({ path, kind });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => scan(item, `${path}[${index}]`, findings));
    return;
  }
  if (value && typeof value === "object") {
    Object.entries(value).forEach(([key, item]) => scan(item, propertyPath(path, key), findings));
  }
}

function redact(value: JsonValue): JsonValue {
  if (typeof value === "string") {
    const kind = sensitiveKind(value);
    return kind ? `[REDACTED:${kind}]` : value;
  }
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redact(item)]));
  }
  return value;
}

/** Finds sensitive string values only; property names are deliberately never scanned. */
export function scanSensitiveValues(value: unknown): SensitiveValueFinding[] {
  const canonical = canonicalizeJson(value);
  const findings: SensitiveValueFinding[] = [];
  scan(canonical, "$", findings);
  return findings;
}

/** Returns a canonical JSON copy with each sensitive string value replaced. */
export function redactSensitiveValues(value: unknown): JsonValue {
  return canonicalizeJson(redact(canonicalizeJson(value)));
}
