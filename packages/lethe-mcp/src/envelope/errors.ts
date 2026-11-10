import type { ErrorCode, LetheError } from "@lethe/core";

export type ToolErrorCode = ErrorCode | "INVALID_INPUT" | "LOCKED" | "IO_FAILED" | "INTERNAL_ERROR";

export interface ToolError {
  readonly code: ToolErrorCode;
  readonly message: string;
  readonly detail?: unknown;
}

export const TOOL_ERROR_CODES: ReadonlyArray<ToolErrorCode> = [
  "PARSE_INVALID_FRONTMATTER",
  "PARSE_DUPLICATE_ID",
  "CONFIG_INVALID",
  "ONTOLOGY_INVALID_PATTERN",
  "BUDGET_INFEASIBLE",
  "TOMBSTONE_NOT_FOUND",
  "PATH_ESCAPE",
  "PBT_GATE_FAILED",
  "INVALID_INPUT",
  "LOCKED",
  "IO_FAILED",
  "INTERNAL_ERROR",
];

export function isToolErrorCode(x: unknown): x is ToolErrorCode {
  return typeof x === "string" && (TOOL_ERROR_CODES as ReadonlyArray<string>).includes(x);
}

/** Builds a ToolError, omitting `detail` when undefined (exactOptionalPropertyTypes). */
export function toolError(code: ToolErrorCode, message: string, detail?: unknown): ToolError {
  return detail === undefined ? { code, message } : { code, message, detail };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (typeof v !== "object" || v === null) return false;
  const proto: unknown = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/** Removes `stack` properties and Error instances (recursively). Returns undefined for a bare Error. */
export function sanitizeDetail(detail: unknown): unknown {
  if (detail instanceof Error) return undefined;
  if (Array.isArray(detail)) {
    return detail.map((x: unknown) => sanitizeDetail(x)).filter((x) => x !== undefined);
  }
  if (!isPlainObject(detail)) return detail;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(detail).sort()) {
    if (key === "stack") continue;
    const clean = sanitizeDetail(detail[key]);
    if (clean !== undefined) out[key] = clean;
  }
  return out;
}

export function mapCoreError(e: LetheError): ToolError {
  return toolError(e.code, e.message, sanitizeDetail(e.detail));
}

function describe(e: unknown): string {
  if (e instanceof Error) return e.stack ?? `${e.name}: ${e.message}`;
  try {
    return String(e);
  } catch {
    return "unprintable error";
  }
}

/** Generic INTERNAL_ERROR; the full error goes only to `log` (stderr in the server). */
export function fromUnknown(e: unknown, log?: (msg: string) => void): ToolError {
  if (log !== undefined) log(describe(e));
  return toolError("INTERNAL_ERROR", "An internal error occurred.");
}
