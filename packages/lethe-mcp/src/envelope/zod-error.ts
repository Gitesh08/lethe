import { err, ok } from "@lethe/core";
import type { Result } from "@lethe/core";
import type { z } from "zod";
import { toolError } from "./errors.js";
import type { ToolError } from "./errors.js";

/** One validation problem. Nothing but `path` and `message` ever reaches the model (Req 6.6). */
export interface InvalidInputIssue {
  readonly path: string;
  readonly message: string;
}

/**
 * Path format: segments joined with `.`; numbers are plain (`items.0.id`);
 * symbols use String(sym); an empty path is `(root)`.
 */
export function formatIssuePath(path: ReadonlyArray<PropertyKey>): string {
  if (path.length === 0) return "(root)";
  return path.map((seg) => String(seg)).join(".");
}

/** Maps a ZodError to INVALID_INPUT; detail keeps zod's issue order and only `{ path, message }`. */
export function fromZodError(e: z.ZodError): ToolError {
  const detail: ReadonlyArray<InvalidInputIssue> = e.issues.map((issue) => ({
    path: formatIssuePath(issue.path),
    message: issue.message,
  }));
  const n = detail.length;
  return toolError("INVALID_INPUT", n === 1 ? "invalid input" : `invalid input (${n} issues)`, detail);
}

/** Validates `raw` against `schema`, mapping failure to INVALID_INPUT. */
export function parseInput<S extends z.ZodType>(schema: S, raw: unknown): Result<z.output<S>, ToolError> {
  const parsed = schema.safeParse(raw);
  return parsed.success ? ok(parsed.data) : err(fromZodError(parsed.error));
}
