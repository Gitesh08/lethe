// Parse `<!-- lethe: ... -->` annotation comments embedded in engram bodies.
// Refs: REQ-PAR-4

import type { Annotation } from "../types.js";

/** Regex that captures the content between `<!-- lethe:` and `-->`. */
const ANNOTATION_RE = /<!--\s*lethe:\s*(.*?)-->/s;

/**
 * Parse a Lethe annotation comment from an engram body.
 *
 * Scans `body` for the first occurrence of `<!-- lethe: ... -->` and extracts
 * three optional key=value pairs (separated by `;`):
 *
 * - `globs=a,b,c`  → `globs: ["a", "b", "c"]` (trimmed; empty array if absent)
 * - `spec=n1,n2`   → `specLinks: ["n1", "n2"]` (trimmed; empty array if absent)
 * - `pin=true`     → `pinned: true` (false if absent or any other value)
 *
 * Unknown keys are silently ignored. Never throws; always returns a valid
 * `Annotation`.
 *
 * @example
 * parseAnnotation("<!-- lethe: globs=**\/*.ts; spec=lethe-core; pin=true -->")
 * // { globs: ["**\/*.ts"], specLinks: ["lethe-core"], pinned: true }
 */
export function parseAnnotation(body: string): Annotation {
  const match = ANNOTATION_RE.exec(body);
  if (match === null) {
    return { globs: [], specLinks: [], pinned: false };
  }

  const content = match[1] ?? "";
  const pairs = content.split(";");

  let globs: readonly string[] = [];
  let specLinks: readonly string[] = [];
  let pinned = false;

  for (const pair of pairs) {
    const eqIdx = pair.indexOf("=");
    if (eqIdx === -1) continue;

    const key = pair.slice(0, eqIdx).trim();
    const value = pair.slice(eqIdx + 1).trim();

    if (key === "globs") {
      globs = splitTrimmed(value);
    } else if (key === "spec") {
      specLinks = splitTrimmed(value);
    } else if (key === "pin") {
      pinned = value === "true";
    }
    // Unknown keys: silently ignore
  }

  return { globs, specLinks, pinned };
}

/** Split a comma-separated string and trim each token, filtering empty strings. */
function splitTrimmed(value: string): readonly string[] {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
