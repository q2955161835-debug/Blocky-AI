export type DiagnosticSeverity = "error";

export interface Diagnostic {
  code: string;
  message: string;
  severity: DiagnosticSeverity;
  blockId?: string;
}
