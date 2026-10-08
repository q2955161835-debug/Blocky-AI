import type { Diagnostic } from "@blocky/language-schema";

export type Envelope = {
  schemaVersion: "blocky.cli/v1";
  ok: boolean;
  command: string;
  data: unknown;
  warnings: string[];
  artifacts: { path: string; sha256: string; bytes: number }[];
  nextCursor: string | null;
  error?: { code: string; message: string; path: string; hint: string };
};
export class CliError extends Error {
  constructor(
    public exitCode: number,
    public code: string,
    message: string,
    public hint = "运行 blocky --help 查看命令。",
    public diagnostics: Diagnostic[] = [],
  ) {
    super(message);
  }
}
export const envelope = (command: string, data: unknown): Envelope => ({
  schemaVersion: "blocky.cli/v1",
  ok: true,
  command,
  data,
  warnings: [],
  artifacts: [],
  nextCursor: null,
});
export function failure(command: string, error: unknown) {
  const e =
    error instanceof CliError
      ? error
      : new CliError(
          10,
          "BLK-CLI-010",
          "命令执行失败。",
          "请检查输入或运行 doctor；错误输出已省略输入内容。",
        );
  const result = envelope(
    command,
    e.diagnostics.length ? { diagnostics: e.diagnostics } : null,
  );
  result.ok = false;
  result.error = { code: e.code, message: e.message, path: "", hint: e.hint };
  return { exitCode: e.exitCode, result };
}
