export type Severity = "error" | "warning";

export interface Diagnostic {
  code: string;
  severity: Severity;
  message: string;
  file?: string;
  /** Byte offset into the source, when known. */
  start?: number;
  end?: number;
  /** 1-based line of `start`, when the reporter could compute it. */
  line?: number;
  /** Dotted path into the style object, e.g. `hero.desktop.fontSize`. */
  path?: string;
}

export function formatDiagnostic(d: Diagnostic): string {
  const file = d.file && d.line ? `${d.file}:${d.line}` : d.file;
  const where = [file, d.path].filter(Boolean).join(" › ");

  return `[${d.code}] ${d.message}${where ? `\n  at ${where}` : ""}`;
}

export function error(
  code: string,
  message: string,
  extra: Partial<Diagnostic> = {}
): Diagnostic {
  return { code, severity: "error", message, ...extra };
}

export function warning(
  code: string,
  message: string,
  extra: Partial<Diagnostic> = {}
): Diagnostic {
  return { code, severity: "warning", message, ...extra };
}
