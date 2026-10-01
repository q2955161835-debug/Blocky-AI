import { CliError } from "./protocol";
const booleans = new Set([
  "json",
  "jsonl",
  "simulate",
  "live",
  "interactive",
  "help",
  "version",
  "reuse-bindings",
  "surface",
  "control-stdin",
  "download",
  "workspace",
]);
export type Args = { words: string[]; options: Map<string, string | true> };
export function parse(argv: string[]): Args {
  const words: string[] = [],
    options = new Map<string, string | true>();
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === "--") {
      words.push(...argv.slice(i + 1));
      break;
    }
    if (token.startsWith("--")) {
      const key = token.slice(2);
      if (!key || key.includes("=") || options.has(key))
        throw new CliError(2, "BLK-CLI-002", "参数重复或格式无效。");
      if (booleans.has(key)) options.set(key, true);
      else {
        const value = argv[++i];
        if (!value || value.startsWith("--"))
          throw new CliError(2, "BLK-CLI-002", "参数缺少值。");
        options.set(key, value);
      }
    } else if (token.startsWith("-"))
      throw new CliError(2, "BLK-CLI-002", "不支持此简写参数。");
    else words.push(token);
  }
  return { words, options };
}
export function allow(args: Args, keys: string[], wordCount: number) {
  if (
    args.words.length !== wordCount ||
    [...args.options.keys()].some((k) => !keys.includes(k))
  )
    throw new CliError(2, "BLK-CLI-002", "命令参数不受支持。");
}
export function required(args: Args, key: string): string {
  const value = args.options.get(key);
  if (typeof value !== "string")
    throw new CliError(2, "BLK-CLI-002", `缺少 --${key} 参数。`);
  return value;
}
export function integer(
  args: Args,
  key: string,
  fallback: number,
  max: number,
) {
  const value = args.options.get(key);
  if (value === undefined) return fallback;
  if (
    typeof value !== "string" ||
    !/^\d+$/.test(value) ||
    Number(value) < 1 ||
    Number(value) > max
  )
    throw new CliError(2, "BLK-CLI-002", `--${key} 超出允许范围。`);
  return Number(value);
}
