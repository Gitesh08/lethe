/** Non-fatal observations attached to an envelope. Pure; no IO. */
export type DiagnosticCode =
  | "PARSE_SKIPPED"
  | "FILE_TOO_LARGE"
  | "FILE_NOT_UTF8"
  | "LEDGER_TORN_TAIL"
  | "LEDGER_LINE_SKIPPED"
  | "LEDGER_REWRITTEN"
  | "FIRST_SEEN_SYNTHESISED"
  | "COMMIT_BEFORE_CHECKPOINT"
  | "GIT_COMMIT_COUNT_UNAVAILABLE"
  | "GIT_FILES_UNAVAILABLE"
  | "FILES_TRUNCATED"
  | "STATE_NOT_UPDATED"
  | "INTERRUPTED_APPLY_RECOVERED"
  | "PATH_DROPPED";

export interface Diagnostic {
  readonly file?: string;
  readonly code: DiagnosticCode;
  readonly message: string;
}

/** Builds a Diagnostic, omitting `file` when it is undefined (exactOptionalPropertyTypes). */
export function diagnostic(code: DiagnosticCode, message: string, file?: string): Diagnostic {
  return file === undefined ? { code, message } : { file, code, message };
}
