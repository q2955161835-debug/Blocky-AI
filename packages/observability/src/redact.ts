import { agentBudgetLimits, type Json } from "@blocky/language-schema";
const sensitiveKey =
  /authorization|cookie|password|api[_-]?key|token|secret|^(?:prompt|body|stdout|stderr|environment)$/i;
const tokenCounters = new Set(["inputTokens", "outputTokens", "totalTokens", "reservedOutputTokens", "maxOutputTokens", "maxOutputTokensPerTurn", "contextTokens"]);
/** Known bounded counters and explicitly unavailable usage carry no credential text. */
export function isPublicTokenCounter(key: string, value: unknown): value is number | string | null {
  if (key === "OUTPUT_TOKENS" && typeof value === "string" && /^\d{1,10}$/.test(value) && Number(value) <= agentBudgetLimits.outputTokens) return true;
  if (value === null && ["inputTokens", "outputTokens", "totalTokens"].includes(key)) return true;
  return tokenCounters.has(key) && typeof value === "number" &&
    Number.isSafeInteger(value) && value >= 0;
}
export function redact(input: unknown): {
  value: Json;
  redaction: { applied: boolean; categories: string[] };
} {
  const categories = new Set<string>();
  const text = (v: string) =>
    v
      .replace(
        /\bBearer\s+\S+|(?:password|token|api[_-]?key)\s*[=:]\s*[^\s,;]+|<fixture-invalid-[^>]+>/gi,
        () => {
          categories.add("credential");
          return "[已脱敏]";
        },
      )
      .replace(/(?<![A-Za-z0-9+.-])[A-Za-z]:[\\/][^\s"<>]+/g, () => {
        categories.add("private-path");
        return "[本机路径]";
      });
  const visit = (v: unknown, depth = 0): Json => {
    if (depth > 30) {
      categories.add("oversize");
      return "[已截断]";
    }
    if (typeof v === "string") {
      const safe = text(v);
      if (new TextEncoder().encode(safe).length <= 16000) return safe;
      categories.add("oversize");
      let result = "",
        bytes = 0;
      for (const char of safe) {
        const size = new TextEncoder().encode(char).length;
        if (bytes + size > 15950) break;
        result += char;
        bytes += size;
      }
      return result + "[已截断]";
    }
    if (v === null || typeof v === "boolean") return v;
    if (typeof v === "number") return Number.isFinite(v) ? v : null;
    if (Array.isArray(v)) {
      if (v.length > 1000) categories.add("oversize");
      return v.slice(0, 1000).map((x) => visit(x, depth + 1));
    }
    if (v && typeof v === "object") {
      if (Object.keys(v).length > 1000) categories.add("oversize");
      return Object.fromEntries(
        Object.entries(v)
          .slice(0, 1000)
          .map(([k, x]) => {
            if (isPublicTokenCounter(k, x))
              return [k, x];
            if (sensitiveKey.test(k)) {
              categories.add("credential");
              return [k, "[已脱敏]"];
            }
            return [k, visit(x, depth + 1)];
          }),
      );
    }
    return null;
  };
  const value = visit(input);
  return {
    value,
    redaction: { applied: categories.size > 0, categories: [...categories] },
  };
}
