import type { ToolError } from "./errors.js";

/** Maximum summary length, counted in Unicode code points (not UTF-16 units). */
export const SUMMARY_MAX_CHARS = 400;

const ELLIPSIS = "\u2026";

export type Envelope<D> =
  | { readonly ok: true; readonly summary: string; readonly data: D }
  | { readonly ok: false; readonly summary: string; readonly error: ToolError };

/**
 * Collapses every whitespace run (including newlines, tabs, CR, U+2028, U+2029,
 * U+0085) to one space, trims, and cuts to at most 400 code points. A cut result
 * is 399 code points plus "…". Code points are counted via Array.from, so a
 * surrogate pair is never split. Idempotent.
 */
export function normaliseSummary(s: string): string {
  const collapsed = s.replace(/[\s\u0085\u2028\u2029]+/gu, " ").trim();
  const points = Array.from(collapsed);
  if (points.length <= SUMMARY_MAX_CHARS) return collapsed;
  // Trim again so a cut that lands after a space never leaves "␠…".
  return points.slice(0, SUMMARY_MAX_CHARS - 1).join("").trimEnd() + ELLIPSIS;
}

export function ok<D>(summary: string, data: D): Envelope<D> {
  return { ok: true, summary: normaliseSummary(summary), data };
}

/** Failure envelope; the default summary is `${code}: ${message}`. */
export function fail(error: ToolError, summary?: string): Envelope<never> {
  const text = summary ?? `${error.code}: ${error.message}`;
  return { ok: false, summary: normaliseSummary(text), error };
}

/**
 * JSON text for the MCP text content block. Key order is whatever the builders
 * produced (data objects are already key-ordered); no sorting is added here.
 */
export function envelopeText<D>(env: Envelope<D>): string {
  return JSON.stringify(env);
}
