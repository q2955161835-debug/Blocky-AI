import { redact } from "@blocky/observability";
/** Sanitize display text at the transport boundary; keep schema keys and safe references intact. */
export function output(value: unknown): string {
  let changed = false;
  const visit = (v: unknown): unknown => {
    if (typeof v === "string") {
      // A Windows drive/UNC path can contain spaces; redact its entire remainder.
      const pathSafe = v.replace(
        /(?:(?<![A-Za-z0-9+.-])[A-Za-z]:[\\/]|\\\\)[^\r\n"<>]*/g,
        "[本机路径]",
      );
      const safe = redact(pathSafe).value;
      if (safe !== v) changed = true;
      return safe;
    }
    if (Array.isArray(v)) return v.map(visit);
    if (v && typeof v === "object")
      return Object.fromEntries(
        Object.entries(v).map(([k, item]) => {
          const isReference = [
            "secretRef",
            "secretRefs",
            "secretBindings",
          ].includes(k);
          if (
            !isReference &&
            /authorization|cookie|password|api[_-]?key|token|secret/i.test(k)
          ) {
            changed = true;
            return [String(visit(k)), "[已脱敏]"];
          }
          return [String(visit(k)), visit(item)];
        }),
      );
    return v;
  };
  const safe = visit(value) as Record<string, unknown>;
  if (
    changed &&
    safe?.schemaVersion === "blocky.cli/v1" &&
    Array.isArray(safe.warnings)
  ) {
    safe.warnings.push("输出中的敏感文本已脱敏；摘要仍对应原始项目语义。");
  }
  return JSON.stringify(safe) + "\n";
}
