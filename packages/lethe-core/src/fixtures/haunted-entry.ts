// Authoring model for haunted-repo content: one Entry per steering section (= engram).
// Refs: REQ-SBX-1

import { slugify } from "../parse/slug.js";

/**
 * How an engram is meant to behave at the demo clock (150 commits, 60 days):
 * - pinHot:   protected (pin / active-spec link), reinforced by the ledger => Hot
 * - pinFloor: protected, never reinforced => raw R ~ 0, held at the 0.50 floor (Warm)
 * - liveHot:  unprotected, reinforced by the ledger => Hot
 * - warm:     unprotected, moderately aged => Warm survivor
 * - dupKeep / dupDrop: near-duplicate pair; the keep side has the higher retention
 * - loserHot: unprotected, still Hot, but contradicts a protected rule => defeated
 * - stale:    unprotected, long unreinforced => retention << cryptMax
 */
export type Role =
  | "pinHot"
  | "pinFloor"
  | "liveHot"
  | "warm"
  | "dupKeep"
  | "dupDrop"
  | "loserHot"
  | "stale";

export interface Entry {
  /** 1-based index into STEERING_FILES. */
  readonly file: number;
  readonly heading: string;
  readonly level: 2 | 3;
  /** The H2 heading above an H3 entry (needed to build the engram id). */
  readonly parent?: string;
  readonly role: Role;
  /** Annotation content without the comment markers, e.g. "spec=lethe-core; pin=true". */
  readonly ann?: string;
  /** Section text (may contain `{a|b}` wording variants, resolved by the seeded rng). */
  readonly body: string;
}

export function h2(file: number, role: Role, heading: string, body: string, ann?: string): Entry {
  return ann === undefined ? { file, heading, level: 2, role, body } : { file, heading, level: 2, role, body, ann };
}

export function h3(
  file: number,
  role: Role,
  parent: string,
  heading: string,
  body: string,
  ann?: string,
): Entry {
  return ann === undefined
    ? { file, heading, level: 3, parent, role, body }
    : { file, heading, level: 3, parent, role, body, ann };
}

/** Engram id the parser will assign to this entry in `path`. */
export function entryId(path: string, entry: Entry): string {
  const headingPath = entry.level === 3 && entry.parent !== undefined ? [entry.parent, entry.heading] : [entry.heading];
  return slugify(path, headingPath);
}
